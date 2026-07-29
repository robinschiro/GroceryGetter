import express from "express";
import { randomUUID } from "node:crypto";
import {
  insert,
  queryAll,
  queryOne,
  run,
  saveDb,
  setDefaultDatabase,
  transaction,
  type GroceryDatabase
} from "./db.js";
import type { CartSubmissionProgress, CartSubmissionResult } from "./qfcAdapter.js";
import type { QfcService } from "./qfcAdapter.js";
import { createRecipeRepository } from "./features/recipes/recipeRepository.js";
import { createRecipeRouter } from "./features/recipes/recipeRouter.js";
import { createRecipeService } from "./features/recipes/recipeService.js";
import { createShoppingListRepository } from "./features/shoppingLists/shoppingListRepository.js";
import { createShoppingListRouter } from "./features/shoppingLists/shoppingListRouter.js";
import { createShoppingListService } from "./features/shoppingLists/shoppingListService.js";
import { createPlannerRepository } from "./features/planner/plannerRepository.js";
import { createPlannerRouter } from "./features/planner/plannerRouter.js";
import { createPlannerService } from "./features/planner/plannerService.js";
import { createShoppingListWorkflowRepository } from "./features/planner/shoppingListRepository.js";
import { createShoppingListWorkflowService } from "./features/planner/shoppingListService.js";
import type { DataScope } from "./types.js";

type TestSeedIngredient = {
  text: string;
  quantity?: string;
  unit?: string;
  item: string;
};

type TestSeed = {
  recipes?: Array<{
    name: string;
    category: "entree" | "vegetable_side" | "starch_side";
    dataScope?: DataScope;
    includeInMenuGeneration?: boolean;
    servings?: number | null;
    notes?: string;
    ingredients?: TestSeedIngredient[];
  }>;
  customShoppingLists?: Array<{
    name: string;
    dataScope?: DataScope;
    includeInMenuByDefault?: boolean;
    items?: TestSeedIngredient[];
  }>;
  settings?: Record<string, string>;
  scopedSettings?: Array<{ dataScope: DataScope; key: string; value: string }>;
};

function seedTestDatabase(database: GroceryDatabase, seed: TestSeed) {
  database.transaction(() => {
    for (const [key, value] of Object.entries(seed.settings ?? {})) {
      database.run(
        `INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, value]
      );
    }
    for (const setting of seed.scopedSettings ?? []) {
      database.run(
        `INSERT INTO scoped_settings (data_scope, key, value) VALUES (?, ?, ?)
        ON CONFLICT(data_scope, key) DO UPDATE SET value = excluded.value`,
        [setting.dataScope, setting.key, setting.value]
      );
    }
    for (const recipe of seed.recipes ?? []) {
      const recipeId = database.insert(
        `INSERT INTO recipes (
          name, category, data_scope, include_in_menu_generation, servings, notes
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          recipe.name,
          recipe.category,
          recipe.dataScope ?? "production",
          recipe.includeInMenuGeneration === false ? 0 : 1,
          recipe.servings ?? null,
          recipe.notes ?? ""
        ]
      );
      for (const [sortOrder, ingredient] of (recipe.ingredients ?? []).entries()) {
        database.run(
          `INSERT INTO recipe_ingredients (
            recipe_id, text, quantity, unit, item, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            recipeId,
            ingredient.text,
            ingredient.quantity ?? "",
            ingredient.unit ?? "",
            ingredient.item,
            sortOrder
          ]
        );
      }
    }
    for (const list of seed.customShoppingLists ?? []) {
      const listId = database.insert(
        `INSERT INTO custom_shopping_lists (
          name, data_scope, include_in_menu_by_default
        ) VALUES (?, ?, ?)`,
        [
          list.name,
          list.dataScope ?? "production",
          list.includeInMenuByDefault ? 1 : 0
        ]
      );
      for (const [sortOrder, item] of (list.items ?? []).entries()) {
        database.run(
          `INSERT INTO custom_shopping_list_items (
            custom_shopping_list_id, text, quantity, unit, item, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            listId,
            item.text,
            item.quantity ?? "",
            item.unit ?? "",
            item.item,
            sortOrder
          ]
        );
      }
    }
  });

  return {
    recipes: seed.recipes?.length ?? 0,
    customShoppingLists: seed.customShoppingLists?.length ?? 0
  };
}

export function createApp({
  database,
  qfcService,
  testMode = false
}: {
  database: GroceryDatabase;
  qfcService: QfcService;
  testMode?: boolean;
}) {
  setDefaultDatabase(database);
  const {
    addQfcMatchesToCart,
    createCustomerAuthorizationUrl,
    deleteStoreItemPreference,
    exchangeCustomerAuthorizationCode,
    getQfcApiStatus,
    getScopedSetting,
    getStoreItemPreferences,
    previewQfcCart,
    refreshCustomerToken,
    saveQfcApiSettings,
    saveStoreItemPreference,
    searchLocations,
    searchStoreItems,
    setScopedSetting
  } = qfcService;
  const plannerRepository = createPlannerRepository(database);
  const plannerService = createPlannerService(plannerRepository);
  const shoppingListWorkflowService = createShoppingListWorkflowService(
    plannerRepository,
    createShoppingListWorkflowRepository(database)
  );

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
  const rawScope = req.header("X-Data-Scope")?.trim().toLowerCase() || "production";
  if (rawScope !== "production" && rawScope !== "sandbox") {
    res.status(400).json({ error: "Data scope must be production or sandbox." });
    return;
  }
  res.locals.dataScope = rawScope satisfies DataScope;
  next();
  });

  if (testMode) {
    app.post("/api/test/reset", async (req, res, next) => {
      try {
        await database.reset();
        setDefaultDatabase(database);
        const seeded = seedTestDatabase(database, (req.body?.seed ?? {}) as TestSeed);
        res.json({ reset: true, seeded });
      } catch (error) {
        next(error);
      }
    });
  }

  app.use(
    "/api/recipes",
    createRecipeRouter(createRecipeService(createRecipeRepository(database)))
  );
  app.use(
    "/api/custom-shopping-lists",
    createShoppingListRouter(createShoppingListService(createShoppingListRepository(database)))
  );
  app.use("/api", createPlannerRouter(plannerService, shoppingListWorkflowService));

type QfcSubmitJob = {
  id: string;
  kind: "preview" | "add";
  menuId: string;
  dataScope: DataScope;
  status: "running" | "complete" | "failed";
  progress: CartSubmissionProgress;
  result?: CartSubmissionResult;
  error?: string;
  createdAt: number;
};

const qfcSubmitJobs = new Map<string, QfcSubmitJob>();
const qfcSubmitJobTtlMs = 15 * 60 * 1000;

function requestScope(res: express.Response): DataScope {
  return res.locals.dataScope as DataScope;
}

function pruneQfcSubmitJobs() {
  const cutoff = Date.now() - qfcSubmitJobTtlMs;
  for (const [jobId, job] of qfcSubmitJobs.entries()) {
    if (job.createdAt < cutoff) {
      qfcSubmitJobs.delete(jobId);
    }
  }
}

function getScopedQfcSubmitJob(jobId: string, dataScope: DataScope) {
  const job = qfcSubmitJobs.get(jobId);
  return job?.dataScope === dataScope ? job : undefined;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getMenu(menuId: number, dataScope: DataScope) {
  return plannerRepository.getMenu(menuId, dataScope);
}

function getShoppingListItems(menuId: number, dataScope: DataScope) {
  return plannerRepository.getShoppingListItems(menuId, dataScope);
}

app.get("/api/settings", (_req, res) => {
  const settings = queryAll(
    "SELECT key, value FROM scoped_settings WHERE data_scope = ? ORDER BY key",
    [requestScope(res)]
  ) as Array<{
    key: string;
    value: string;
  }>;
  res.json(Object.fromEntries(settings.map(({ key, value }) => [key, value])));
});

app.put("/api/settings/:key", (req, res) => {
  const key = req.params.key;
  if (!["preferStoreBrands", "allowRealQfcCartMutation"].includes(key)) {
    res.status(400).json({ error: "This setting cannot be changed through the scoped settings API." });
    return;
  }
  const value = String(req.body.value ?? "");
  setScopedSetting(requestScope(res), key, value);
  res.json({ key, value });
});

app.get("/api/qfc/status", (_req, res) => {
  res.json(getQfcApiStatus(requestScope(res)));
});

app.put("/api/qfc/settings", (req, res) => {
  const dataScope = requestScope(res);
  const changesGlobalSettings = [
    req.body.clientId,
    req.body.clientSecret,
    req.body.serviceScopes,
    req.body.customerScopes,
    req.body.redirectUri
  ].some((value) => value !== undefined);
  if (dataScope === "sandbox" && changesGlobalSettings) {
    res.status(403).json({ error: "Switch to production mode to change QFC credentials or OAuth settings." });
    return;
  }
  res.json(saveQfcApiSettings({
    clientId: req.body.clientId,
    clientSecret: req.body.clientSecret,
    locationId: req.body.locationId,
    serviceScopes: req.body.serviceScopes,
    customerScopes: req.body.customerScopes,
    redirectUri: req.body.redirectUri
  }, dataScope));
});

app.post("/api/qfc/oauth/start", (_req, res) => {
  if (requestScope(res) === "sandbox") {
    res.status(403).json({ error: "Switch to production mode to connect a QFC customer account." });
    return;
  }
  try {
    res.json(createCustomerAuthorizationUrl());
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to start customer OAuth." });
  }
});

app.get("/api/qfc/oauth/callback", async (req, res) => {
  try {
    const error = req.query.error ? String(req.query.error) : "";
    if (error) {
      const description = req.query.error_description ? String(req.query.error_description) : error;
      res.status(400).send(`<!doctype html>
        <html><body>
          <h1>QFC authorization failed</h1>
          <p>${escapeHtml(description)}</p>
          <p>You can close this tab and try again from Grocery Getter.</p>
        </body></html>`);
      return;
    }

    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    if (!code) {
      res.status(400).send(`<!doctype html>
        <html><body>
          <h1>QFC authorization failed</h1>
          <p>Kroger did not include an authorization code.</p>
        </body></html>`);
      return;
    }

    await exchangeCustomerAuthorizationCode({ code, state });
    res.send(`<!doctype html>
      <html><body>
        <h1>QFC authorization complete</h1>
        <p>Grocery Getter has stored the customer OAuth token locally. You can close this tab and return to the app.</p>
      </body></html>`);
  } catch (error) {
    res.status(400).send(`<!doctype html>
      <html><body>
        <h1>QFC authorization failed</h1>
        <p>${escapeHtml(error instanceof Error ? error.message : "Unable to complete customer OAuth.")}</p>
      </body></html>`);
  }
});

app.post("/api/qfc/oauth/refresh", async (_req, res) => {
  if (requestScope(res) === "sandbox") {
    res.status(403).json({ error: "Switch to production mode to refresh QFC authorization." });
    return;
  }
  try {
    res.json(await refreshCustomerToken());
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to refresh customer token." });
  }
});

app.get("/api/qfc/locations", async (req, res) => {
  try {
    const query = String(req.query.query ?? "");
    const limit = Number(req.query.limit ?? 10);
    if (!query.trim()) {
      res.status(400).json({ error: "A location search query is required." });
      return;
    }

    res.json(await searchLocations(query, limit));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to search locations." });
  }
});

app.get("/api/qfc/store-items", async (req, res) => {
  try {
    const term = String(req.query.term ?? "");
    const limit = Number(req.query.limit ?? 10);
    const locationId = req.query.locationId ? String(req.query.locationId) : undefined;
    if (!term.trim()) {
      res.status(400).json({ error: "A store item search term is required." });
      return;
    }

    res.json(await searchStoreItems(term, { locationId, limit, dataScope: requestScope(res) }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to search store items." });
  }
});

app.get("/api/store-item-preferences", (_req, res) => {
  res.json(getStoreItemPreferences(requestScope(res)));
});

app.delete("/api/store-item-preferences/:provider/:ingredientKey", (req, res) => {
  deleteStoreItemPreference(requestScope(res), req.params.provider, req.params.ingredientKey);
  res.json({ ok: true });
});

app.post("/api/menus/:id/preview-qfc", async (req, res) => {
  const dataScope = requestScope(res);
  const menuId = req.params.id;
  if (!getMenu(Number(menuId), dataScope)) {
    res.status(404).json({ error: "Menu not found." });
    return;
  }
  const rows = getShoppingListItems(Number(menuId), dataScope)
    .filter((item) => Boolean(item.approved));

  pruneQfcSubmitJobs();
  const jobId = randomUUID();
  const job: QfcSubmitJob = {
    id: jobId,
    kind: "preview",
    menuId,
    dataScope,
    status: "running",
    progress: {
      phase: "checking",
      processedItems: 0,
      totalItems: rows.length,
      message: "Starting store item matching..."
    },
    createdAt: Date.now()
  };
  qfcSubmitJobs.set(jobId, job);

  void previewQfcCart(dataScope, rows, (progress) => {
    job.progress = progress;
  })
    .then((result) => {
      job.status = "complete";
      job.result = result;
      job.progress = {
        phase: "complete",
        processedItems: rows.length,
        totalItems: rows.length,
        message: result.message
      };
    })
    .catch((error: unknown) => {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : "Store item matching failed.";
      job.progress = {
        phase: "complete",
        processedItems: rows.length,
        totalItems: rows.length,
        message: job.error
      };
    });

  res.status(202).json({ jobId, ...job });
});

app.put("/api/store-item-reviews/:jobId/selections/:shoppingItemId", (req, res) => {
  pruneQfcSubmitJobs();
  const previewJob = getScopedQfcSubmitJob(req.params.jobId, requestScope(res));
  if (!previewJob || previewJob.kind !== "preview" || previewJob.status !== "complete" || !previewJob.result) {
    res.status(409).json({ error: "The store item review is unavailable or incomplete. Preview the store items again." });
    return;
  }

  const shoppingItemId = Number(req.params.shoppingItemId);
  const match = previewJob.result.matched?.find((candidateMatch) => candidateMatch.item.id === shoppingItemId);
  if (!match) {
    res.status(404).json({ error: "The ingredient was not found in this store item review." });
    return;
  }

  const productId = String(req.body.productId ?? "");
  const upc = String(req.body.upc ?? "");
  const storeItem = match.candidates.find((candidate) =>
    candidate.productId === productId && candidate.upc === upc
  );
  if (!storeItem) {
    res.status(400).json({ error: "Choose a store item from the current review results." });
    return;
  }

  const ingredientName = match.item.item.trim() || match.item.text.trim();
  const preference = saveStoreItemPreference(previewJob.dataScope, "kroger", ingredientName, storeItem);
  match.storeItem = storeItem;
  match.selectionSource = "remembered";
  res.json({ match, preference });
});

app.put("/api/store-item-reviews/:jobId/quantities/:shoppingItemId", (req, res) => {
  pruneQfcSubmitJobs();
  const previewJob = getScopedQfcSubmitJob(req.params.jobId, requestScope(res));
  if (!previewJob || previewJob.kind !== "preview" || previewJob.status !== "complete" || !previewJob.result) {
    res.status(409).json({ error: "The store item review is unavailable or incomplete. Preview the store items again." });
    return;
  }

  const shoppingItemId = Number(req.params.shoppingItemId);
  const match = previewJob.result.matched?.find((candidateMatch) => candidateMatch.item.id === shoppingItemId);
  if (!match) {
    res.status(404).json({ error: "The ingredient was not found in this store item review." });
    return;
  }

  const cartQuantity = Number(req.body.cartQuantity);
  if (!Number.isSafeInteger(cartQuantity) || cartQuantity < 1) {
    res.status(400).json({ error: "Cart quantity must be a positive whole number." });
    return;
  }

  match.cartQuantity = cartQuantity;
  res.json({ match });
});

app.post("/api/store-item-reviews/:jobId/items/:shoppingItemId/search", async (req, res) => {
  pruneQfcSubmitJobs();
  const previewJob = getScopedQfcSubmitJob(req.params.jobId, requestScope(res));
  if (!previewJob || previewJob.kind !== "preview" || previewJob.status !== "complete" || !previewJob.result) {
    res.status(409).json({ error: "The store item review is unavailable or incomplete. Preview the store items again." });
    return;
  }

  const shoppingItemId = Number(req.params.shoppingItemId);
  const matches = previewJob.result.matched ?? [];
  const skipped = previewJob.result.skipped ?? [];
  let match = matches.find((candidateMatch) => candidateMatch.item.id === shoppingItemId);
  let skip = skipped.find((candidateSkip) => candidateSkip.item.id === shoppingItemId);
  let restoredItem = null;
  if (!match && !skip) {
    restoredItem = getShoppingListItems(Number(previewJob.menuId), previewJob.dataScope)
      .find((candidate) => candidate.id === shoppingItemId && candidate.approved);
    if (!restoredItem) {
      res.status(404).json({ error: "The ingredient was not found in this store item review." });
      return;
    }
    skip = { item: restoredItem, reason: "No store item has been selected." };
  }

  const term = String(req.body.term ?? "").trim();
  if (!term) {
    res.status(400).json({ error: "Enter a search term to find store items." });
    return;
  }

  try {
    const results = await searchStoreItems(term, { limit: 20, dataScope: previewJob.dataScope });
    const candidateKeys = new Set<string>();
    const candidates = results.filter((candidate) => {
      const key = `${candidate.productId}\u0000${candidate.upc}`;
      if (candidateKeys.has(key)) return false;
      candidateKeys.add(key);
      return true;
    });

    if (restoredItem) {
      previewJob.result.items = [...previewJob.result.items, restoredItem]
        .sort((left, right) => left.id - right.id);
    }

    if (candidates.length) {
      if (match) {
        match.candidates = candidates;
        match.storeItem = candidates[0];
        match.selectionSource = "search";
      } else if (skip) {
        match = {
          item: skip.item,
          storeItem: candidates[0],
          candidates,
          selectionSource: "search",
          cartQuantity: 1
        };
        previewJob.result.matched = [...matches, match].sort((left, right) => left.item.id - right.item.id);
        previewJob.result.skipped = skipped.filter((candidateSkip) => candidateSkip.item.id !== shoppingItemId);
      }
    } else if (restoredItem && skip) {
      skip.reason = `No store items found for "${term}".`;
      previewJob.result.skipped = [...skipped, skip].sort((left, right) => left.item.id - right.item.id);
    }

    res.json({
      match: match ?? null,
      items: previewJob.result.items,
      matched: previewJob.result.matched ?? matches,
      skipped: previewJob.result.skipped ?? skipped,
      resultCount: candidates.length
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to search store items." });
  }
});

app.delete("/api/store-item-reviews/:jobId/items/:shoppingItemId", (req, res) => {
  pruneQfcSubmitJobs();
  const previewJob = getScopedQfcSubmitJob(req.params.jobId, requestScope(res));
  if (!previewJob || previewJob.kind !== "preview" || previewJob.status !== "complete" || !previewJob.result) {
    res.status(409).json({ error: "The store item review is unavailable or incomplete. Preview the store items again." });
    return;
  }

  const shoppingItemId = Number(req.params.shoppingItemId);
  const reviewItem = previewJob.result.items.find((item) => item.id === shoppingItemId);
  if (!reviewItem) {
    res.status(404).json({ error: "The ingredient was not found in this store item review." });
    return;
  }

  previewJob.result.items = previewJob.result.items.filter((item) => item.id !== shoppingItemId);
  previewJob.result.matched = (previewJob.result.matched ?? []).filter((match) => match.item.id !== shoppingItemId);
  previewJob.result.skipped = (previewJob.result.skipped ?? []).filter((skip) => skip.item.id !== shoppingItemId);

  res.json({
    removedItem: reviewItem,
    items: previewJob.result.items,
    matched: previewJob.result.matched,
    skipped: previewJob.result.skipped
  });
});

app.post("/api/qfc/submit-jobs/:jobId/add-to-cart", async (req, res) => {
  pruneQfcSubmitJobs();
  const previewJob = getScopedQfcSubmitJob(req.params.jobId, requestScope(res));
  if (!previewJob || previewJob.kind !== "preview" || previewJob.status !== "complete" || !previewJob.result) {
    res.status(409).json({ error: "The store item review is unavailable or incomplete. Preview the store items again." });
    return;
  }
  if (getScopedSetting(previewJob.dataScope, "allowRealQfcCartMutation") !== "true") {
    res.status(403).json({
      error: "Real QFC cart changes are disabled in this data mode. Enable them explicitly in QFC preferences."
    });
    return;
  }

  const jobId = randomUUID();
  const job: QfcSubmitJob = {
    id: jobId,
    kind: "add",
    menuId: previewJob.menuId,
    dataScope: previewJob.dataScope,
    status: "running",
    progress: {
      phase: "adding",
      processedItems: previewJob.result.items.length,
      totalItems: previewJob.result.items.length,
      message: "Adding reviewed store items to your QFC cart..."
    },
    createdAt: Date.now()
  };
  qfcSubmitJobs.set(jobId, job);

  void addQfcMatchesToCart(
    previewJob.result.items,
    previewJob.result.matched ?? [],
    previewJob.result.skipped ?? [],
    (progress) => {
      job.progress = progress;
    }
  )
    .then((result) => {
      if (result.submittedItemCount > 0) {
        run(
          `UPDATE menus SET status = 'submitted', updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND data_scope = ?`,
          [job.menuId, job.dataScope]
        );
        saveDb();
      }
      job.status = "complete";
      job.result = result;
      job.progress = {
        phase: "complete",
        processedItems: result.items.length,
        totalItems: result.items.length,
        message: result.message
      };
    })
    .catch((error: unknown) => {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : "QFC cart submission failed.";
      job.progress = {
        phase: "complete",
        processedItems: previewJob.result?.items.length ?? 0,
        totalItems: previewJob.result?.items.length ?? 0,
        message: job.error
      };
    });

  res.status(202).json({ jobId, ...job });
});

app.get("/api/qfc/submit-jobs/:jobId", (req, res) => {
  pruneQfcSubmitJobs();
  const job = getScopedQfcSubmitJob(req.params.jobId, requestScope(res));
  if (!job) {
    res.status(404).json({ error: "QFC submission job was not found." });
    return;
  }

  res.json(job);
});

  return app;
}
