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
import {
  formatQuantity,
  normalizeAggregateItem,
  parseQuantity
} from "./features/planner/shoppingListDomain.js";
import { createPlannerRepository } from "./features/planner/plannerRepository.js";
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
const recipeCategories = ["entree", "vegetable_side", "starch_side"] as const;
type RecipeCategory = (typeof recipeCategories)[number];
type MenuRecipe = {
  id: number;
  name: string;
  category: RecipeCategory;
  dataScope: DataScope;
};
type MenuItemInput = {
  mealNumber: number;
  slot: RecipeCategory;
  recipeId: number | null;
};
type MenuRow = {
  id: number;
  name: string;
  mealCount: number;
  dataScope: DataScope;
  status: string;
};

function requestScope(res: express.Response): DataScope {
  return res.locals.dataScope as DataScope;
}

type AggregateSource = {
  sourceType: "recipe" | "custom";
  menuItemId: number | null;
  recipeIngredientId: number | null;
  customShoppingListItemId: number | null;
  text: string;
  quantity: string;
  unit: string;
  item: string;
  sourceName: string;
};

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

function shuffle<T>(items: T[]) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function pick<T>(items: T[], index: number) {
  return items[index % items.length];
}

function getPlannerRecipes(dataScope: DataScope) {
  return queryAll(
    `SELECT id, name, category, data_scope AS dataScope
    FROM recipes
    WHERE data_scope = ? AND include_in_menu_generation = 1`,
    [dataScope]
  ) as MenuRecipe[];
}

function getRecipesByCategory(recipes: MenuRecipe[]) {
  return {
    entree: recipes.filter((recipe) => recipe.category === "entree"),
    vegetable_side: recipes.filter((recipe) => recipe.category === "vegetable_side"),
    starch_side: recipes.filter((recipe) => recipe.category === "starch_side")
  };
}

function validateMealCount(mealCount: number) {
  return Number.isInteger(mealCount) && mealCount >= 1 && mealCount <= 14;
}

function buildMenuPreview(mealCount: number, dataScope: DataScope) {
  const byCategory = getRecipesByCategory(getPlannerRecipes(dataScope));

  if (!byCategory.entree.length) {
    return null;
  }

  const shuffledByCategory = {
    entree: shuffle(byCategory.entree),
    vegetable_side: shuffle(byCategory.vegetable_side),
    starch_side: shuffle(byCategory.starch_side)
  };

  const items = Array.from({ length: mealCount }, (_, index) => index + 1).flatMap((mealNumber) =>
    recipeCategories.map((slot) => {
      const recipe = pick(shuffledByCategory[slot], mealNumber - 1);
      return {
        id: null,
        mealNumber,
        slot,
        recipeId: recipe?.id ?? null,
        recipeName: recipe?.name ?? null
      };
    })
  );

  const customShoppingListIds = queryAll<{ id: number }>(
    `SELECT id
    FROM custom_shopping_lists
    WHERE include_in_menu_by_default = 1 AND data_scope = ?
    ORDER BY name COLLATE NOCASE, id`
    ,
    [dataScope]
  ).map((list) => list.id);

  return {
    id: null,
    name: `Week of ${new Date().toLocaleDateString("en-US")}`,
    mealCount,
    dataScope,
    status: "preview",
    items,
    customShoppingListIds
  };
}

function getMenu(menuId: number, dataScope: DataScope) {
  const menu = queryOne<MenuRow>(
    `SELECT id, name, meal_count AS mealCount, data_scope AS dataScope, status
    FROM menus WHERE id = ? AND data_scope = ?`,
    [menuId, dataScope]
  );
  if (!menu) {
    return null;
  }

  const items = queryAll(
    `SELECT
      menu_items.id,
      menu_items.meal_number AS mealNumber,
      menu_items.slot,
      recipes.id AS recipeId,
      recipes.name AS recipeName,
      recipes.category
    FROM menu_items
    LEFT JOIN recipes ON recipes.id = menu_items.recipe_id
    WHERE menu_items.menu_id = ?
    ORDER BY menu_items.meal_number, menu_items.slot`,
    [menuId]
  );

  const customShoppingListIds = queryAll<{ customShoppingListId: number }>(
    `SELECT custom_shopping_list_id AS customShoppingListId
    FROM menu_custom_shopping_lists
    WHERE menu_id = ?
    ORDER BY custom_shopping_list_id`,
    [menuId]
  ).map((row) => row.customShoppingListId);

  return { ...menu, items, customShoppingListIds };
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

app.post("/api/menus/preview", (req, res) => {
  const mealCount = Number(req.body.mealCount ?? 5);
  if (!validateMealCount(mealCount)) {
    res.status(400).json({ error: "Meal count must be between 1 and 14." });
    return;
  }

  const preview = buildMenuPreview(mealCount, requestScope(res));
  if (!preview) {
    res.status(400).json({
      error: "Select at least one entree recipe for menu generation before generating a menu."
    });
    return;
  }

  res.json(preview);
});

app.post("/api/menus", (req, res) => {
  const dataScope = requestScope(res);
  const mealCount = Number(req.body.mealCount);
  const items = Array.isArray(req.body.items) ? req.body.items as MenuItemInput[] : [];
  const customShoppingListIds: number[] = Array.isArray(req.body.customShoppingListIds)
    ? Array.from(new Set<number>(req.body.customShoppingListIds.map((id: unknown) => Number(id))))
    : [];
  if (!validateMealCount(mealCount)) {
    res.status(400).json({ error: "Meal count must be between 1 and 14." });
    return;
  }

  if (items.length !== mealCount * recipeCategories.length) {
    res.status(400).json({ error: "Saved menus must include one recipe for every meal slot." });
    return;
  }
  if (customShoppingListIds.some((id) => !Number.isInteger(id))) {
    res.status(400).json({ error: "Custom shopping-list selections are invalid." });
    return;
  }
  const existingCustomListCount = customShoppingListIds.length
    ? queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count
      FROM custom_shopping_lists
      WHERE data_scope = ? AND id IN (${customShoppingListIds.map(() => "?").join(", ")})`,
      [dataScope, ...customShoppingListIds]
    )?.count ?? 0
    : 0;
  if (existingCustomListCount !== customShoppingListIds.length) {
    res.status(400).json({ error: "One or more selected custom shopping lists do not exist." });
    return;
  }

  const seenSlots = new Set<string>();
  for (const item of items) {
    const mealNumber = Number(item.mealNumber);
    const recipeId = item.recipeId === null ? null : Number(item.recipeId);
    if (!Number.isInteger(mealNumber) || mealNumber < 1 || mealNumber > mealCount) {
      res.status(400).json({ error: "Menu items include an invalid meal number." });
      return;
    }
    if (!recipeCategories.includes(item.slot) || (recipeId !== null && !Number.isInteger(recipeId))) {
      res.status(400).json({ error: "Menu items include an invalid recipe selection." });
      return;
    }
    if (item.slot === "entree" && recipeId === null) {
      res.status(400).json({ error: "Entree slots must include a recipe." });
      return;
    }

    const key = `${mealNumber}:${item.slot}`;
    if (seenSlots.has(key)) {
      res.status(400).json({ error: "Saved menus cannot include duplicate meal slots." });
      return;
    }
    seenSlots.add(key);

    if (recipeId === null) {
      continue;
    }

    const recipe = queryOne<{ category: RecipeCategory }>(
      "SELECT category FROM recipes WHERE id = ? AND data_scope = ?",
      [recipeId, dataScope]
    );
    if (!recipe || recipe.category !== item.slot) {
      res.status(400).json({ error: "Menu items include a recipe that does not match its meal slot." });
      return;
    }
  }

  const menuName = String(req.body.name || `Week of ${new Date().toLocaleDateString("en-US")}`);
  const createdMenuId = transaction(() => {
    const menuId = insert("INSERT INTO menus (name, meal_count, data_scope) VALUES (?, ?, ?)", [
      menuName,
      mealCount,
      dataScope
    ]);
    for (const item of items) {
      run("INSERT INTO menu_items (menu_id, meal_number, slot, recipe_id) VALUES (?, ?, ?, ?)", [
        menuId,
        item.mealNumber,
        item.slot,
        item.recipeId
      ]);
    }
    for (const customShoppingListId of customShoppingListIds) {
      run(
        "INSERT INTO menu_custom_shopping_lists (menu_id, custom_shopping_list_id) VALUES (?, ?)",
        [menuId, customShoppingListId]
      );
    }
    return menuId;
  });

  res.status(201).json({ id: createdMenuId });
});

app.get("/api/menus/latest", (_req, res) => {
  const dataScope = requestScope(res);
  const latest = queryOne<{ id: number }>(
    "SELECT id FROM menus WHERE data_scope = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    [dataScope]
  );
  res.json(latest ? getMenu(latest.id, dataScope) : null);
});

app.get("/api/menus/:id", (req, res) => {
  const dataScope = requestScope(res);
  const menuId = Number(req.params.id);
  const menu = Number.isInteger(menuId) ? getMenu(menuId, dataScope) : null;
  if (!menu) {
    res.status(404).json({ error: "Menu not found." });
    return;
  }
  res.json(menu);
});

app.post("/api/menus/:id/meals", (req, res) => {
  const dataScope = requestScope(res);
  const menuId = Number(req.params.id);
  const menu = Number.isInteger(menuId) ? getMenu(menuId, dataScope) : null;
  const items = Array.isArray(req.body.items) ? req.body.items as MenuItemInput[] : [];
  if (!menu) {
    res.status(404).json({ error: "Menu not found." });
    return;
  }
  if (menu.mealCount >= 14) {
    res.status(400).json({ error: "Menus cannot include more than 14 meals." });
    return;
  }
  if (items.length !== recipeCategories.length) {
    res.status(400).json({ error: "New meals must include every meal slot." });
    return;
  }

  const nextMealNumber = menu.mealCount + 1;
  const seenSlots = new Set<RecipeCategory>();
  for (const item of items) {
    const recipeId = item.recipeId === null ? null : Number(item.recipeId);
    if (!recipeCategories.includes(item.slot) || seenSlots.has(item.slot)) {
      res.status(400).json({ error: "New meals include an invalid or duplicate meal slot." });
      return;
    }
    seenSlots.add(item.slot);
    if (item.slot === "entree" && recipeId === null) {
      res.status(400).json({ error: "Entree slots must include a recipe." });
      return;
    }
    if (recipeId === null) {
      continue;
    }
    if (!Number.isInteger(recipeId)) {
      res.status(400).json({ error: "New meals include an invalid recipe selection." });
      return;
    }
    const recipe = queryOne<{ category: RecipeCategory }>(
      "SELECT category FROM recipes WHERE id = ? AND data_scope = ?",
      [recipeId, dataScope]
    );
    if (!recipe || recipe.category !== item.slot) {
      res.status(400).json({ error: "New meals include a recipe that does not match its meal slot." });
      return;
    }
  }

  transaction(() => {
    run("DELETE FROM menu_shopping_list_items WHERE menu_id = ?", [menuId]);
    for (const item of items) {
      run("INSERT INTO menu_items (menu_id, meal_number, slot, recipe_id) VALUES (?, ?, ?, ?)", [
        menuId,
        nextMealNumber,
        item.slot,
        item.recipeId
      ]);
    }
    run(
      "UPDATE menus SET meal_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [nextMealNumber, menuId]
    );
  });

  res.status(201).json(getMenu(menuId, dataScope));
});

app.delete("/api/menus/:id/meals/:mealNumber", (req, res) => {
  const dataScope = requestScope(res);
  const menuId = Number(req.params.id);
  const mealNumber = Number(req.params.mealNumber);
  const menu = Number.isInteger(menuId) ? getMenu(menuId, dataScope) : null;
  if (!menu) {
    res.status(404).json({ error: "Menu not found." });
    return;
  }
  if (!Number.isInteger(mealNumber) || mealNumber < 1 || mealNumber > menu.mealCount) {
    res.status(400).json({ error: "A valid meal number is required." });
    return;
  }
  if (menu.mealCount === 1) {
    res.status(400).json({ error: "A menu must include at least one meal." });
    return;
  }

  transaction(() => {
    run("DELETE FROM menu_shopping_list_items WHERE menu_id = ?", [menuId]);
    run("DELETE FROM menu_items WHERE menu_id = ? AND meal_number = ?", [menuId, mealNumber]);
    run(
      "UPDATE menu_items SET meal_number = meal_number - 1 WHERE menu_id = ? AND meal_number > ?",
      [menuId, mealNumber]
    );
    run(
      "UPDATE menus SET meal_count = meal_count - 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [menuId]
    );
  });

  res.json(getMenu(menuId, dataScope));
});

app.put("/api/menu-items/:id", (req, res) => {
  const dataScope = requestScope(res);
  const menuItem = queryOne<{
    slot: RecipeCategory;
  }>(
    `SELECT menu_items.slot
    FROM menu_items
    JOIN menus ON menus.id = menu_items.menu_id
    WHERE menu_items.id = ? AND menus.data_scope = ?`,
    [req.params.id, dataScope]
  );
  if (!menuItem) {
    res.status(404).json({ error: "Menu item not found." });
    return;
  }

  const recipeId = req.body.recipeId === null ? null : Number(req.body.recipeId);
  if (recipeId === null) {
    if (menuItem.slot === "entree") {
      res.status(400).json({ error: "Entree slots must include a recipe." });
      return;
    }
  } else {
    if (!Number.isInteger(recipeId)) {
      res.status(400).json({ error: "Menu item includes an invalid recipe selection." });
      return;
    }
    const recipe = queryOne<{ category: RecipeCategory }>(
      "SELECT category FROM recipes WHERE id = ? AND data_scope = ?",
      [recipeId, dataScope]
    );
    if (!recipe || recipe.category !== menuItem.slot) {
      res.status(400).json({ error: "Menu item includes a recipe that does not match its meal slot." });
      return;
    }
  }

  run("UPDATE menu_items SET recipe_id = ? WHERE id = ?", [recipeId, req.params.id]);
  saveDb();
  res.json({ ok: true });
});

app.put("/api/menus/:id/custom-shopping-lists", (req, res) => {
  const dataScope = requestScope(res);
  const menuId = Number(req.params.id);
  const ids: number[] | null = Array.isArray(req.body.customShoppingListIds)
    ? Array.from(new Set<number>(req.body.customShoppingListIds.map((id: unknown) => Number(id))))
    : null;
  if (!Number.isInteger(menuId) || !getMenu(menuId, dataScope)) {
    res.status(404).json({ error: "Menu not found." });
    return;
  }
  if (!ids || ids.some((id) => !Number.isInteger(id))) {
    res.status(400).json({ error: "Custom shopping-list selections are invalid." });
    return;
  }

  const existingCount = ids.length
    ? queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count
      FROM custom_shopping_lists
      WHERE data_scope = ? AND id IN (${ids.map(() => "?").join(", ")})`,
      [dataScope, ...ids]
    )?.count ?? 0
    : 0;
  if (existingCount !== ids.length) {
    res.status(400).json({ error: "One or more selected custom shopping lists do not exist." });
    return;
  }

  transaction(() => {
    run("DELETE FROM menu_custom_shopping_lists WHERE menu_id = ?", [menuId]);
    for (const id of ids) {
      run(
        "INSERT INTO menu_custom_shopping_lists (menu_id, custom_shopping_list_id) VALUES (?, ?)",
        [menuId, id]
      );
    }
    run("UPDATE menus SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [menuId]);
  });
  res.json({ customShoppingListIds: ids });
});

app.post("/api/menus/:id/aggregate", (req, res) => {
  const dataScope = requestScope(res);
  const menuId = Number(req.params.id);
  if (!Number.isInteger(menuId) || !getMenu(menuId, dataScope)) {
    res.status(404).json({ error: "Menu not found." });
    return;
  }

  const recipeSources = queryAll(
      `SELECT
        'recipe' AS sourceType,
        menu_items.id AS menuItemId,
        recipe_ingredients.id AS recipeIngredientId,
        NULL AS customShoppingListItemId,
        recipe_ingredients.text,
        recipe_ingredients.quantity,
        recipe_ingredients.unit,
        recipe_ingredients.item,
        recipes.name AS sourceName
      FROM menu_items
      JOIN recipe_ingredients ON recipe_ingredients.recipe_id = menu_items.recipe_id
      JOIN recipes ON recipes.id = menu_items.recipe_id
      WHERE menu_items.menu_id = ?
      ORDER BY recipes.name, recipe_ingredients.sort_order`,
      [menuId]
    ) as AggregateSource[];
  const customSources = queryAll(
    `SELECT
      'custom' AS sourceType,
      NULL AS menuItemId,
      NULL AS recipeIngredientId,
      custom_shopping_list_items.id AS customShoppingListItemId,
      custom_shopping_list_items.text,
      custom_shopping_list_items.quantity,
      custom_shopping_list_items.unit,
      custom_shopping_list_items.item,
      custom_shopping_lists.name AS sourceName
    FROM menu_custom_shopping_lists
    JOIN custom_shopping_lists
      ON custom_shopping_lists.id = menu_custom_shopping_lists.custom_shopping_list_id
    JOIN custom_shopping_list_items
      ON custom_shopping_list_items.custom_shopping_list_id = custom_shopping_lists.id
    WHERE menu_custom_shopping_lists.menu_id = ?
    ORDER BY custom_shopping_lists.name COLLATE NOCASE, custom_shopping_list_items.sort_order`,
    [menuId]
  ) as AggregateSource[];

  const grouped = new Map<string, AggregateSource[]>();
  for (const row of [...recipeSources, ...customSources]) {
    const normalizedItem = normalizeAggregateItem(row.item);
    const key = normalizedItem || normalizeAggregateItem(row.text);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  transaction(() => {
    run("DELETE FROM menu_shopping_list_items WHERE menu_id = ?", [menuId]);

    const sortedGroups = Array.from(grouped.values()).sort((left, right) => {
      const leftName = left[0].item.trim() || left[0].text.trim();
      const rightName = right[0].item.trim() || right[0].text.trim();
      return leftName.localeCompare(rightName, undefined, { sensitivity: "base" });
    });

    sortedGroups.forEach((group, index) => {
      const first = group[0];
      const sourceNames = Array.from(new Set(group.map((item) => item.sourceName))).join(", ");
      const item = first.item.trim() || first.text.trim();
      const quantities = group.map((source) => parseQuantity(source.quantity));
      const canSumUnitlessQuantities = group.every((source) => !source.unit.trim())
        && quantities.every((quantity): quantity is number => quantity !== null);
      const quantity = canSumUnitlessQuantities
        ? formatQuantity(quantities.reduce<number>((sum, value) => sum + value, 0))
        : "";
      const menuShoppingListItemId = insert(
        `INSERT INTO menu_shopping_list_items
          (menu_id, text, quantity, unit, item, source_names, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [menuId, item, quantity, "", item, sourceNames, index]
      );
      group.forEach((source) => {
        if (
          source.sourceType === "recipe"
          && source.menuItemId !== null
          && source.recipeIngredientId !== null
        ) {
          run(
            `INSERT INTO menu_shopping_list_item_recipe_sources
              (menu_shopping_list_item_id, menu_item_id, recipe_ingredient_id)
            VALUES (?, ?, ?)`,
            [menuShoppingListItemId, source.menuItemId, source.recipeIngredientId]
          );
        } else if (source.customShoppingListItemId !== null) {
          run(
            `INSERT INTO menu_shopping_list_item_custom_sources
              (menu_shopping_list_item_id, custom_shopping_list_item_id)
            VALUES (?, ?)`,
            [menuShoppingListItemId, source.customShoppingListItemId]
          );
        }
      });
    });
  });

  res.status(201).json({ ok: true });
});

app.get("/api/menus/:id/shopping-list", (req, res) => {
  const dataScope = requestScope(res);
  const menuId = Number(req.params.id);
  if (!Number.isInteger(menuId)) {
    res.status(400).json({ error: "A valid menu id is required." });
    return;
  }
  if (!getMenu(menuId, dataScope)) {
    res.status(404).json({ error: "Menu not found." });
    return;
  }
  res.json(getShoppingListItems(menuId, dataScope));
});

app.delete("/api/menus/:id/shopping-list", (req, res) => {
  const dataScope = requestScope(res);
  const menuId = Number(req.params.id);
  if (!Number.isInteger(menuId) || !getMenu(menuId, dataScope)) {
    res.status(404).json({ error: "Menu not found." });
    return;
  }
  run("DELETE FROM menu_shopping_list_items WHERE menu_id = ?", [menuId]);
  saveDb();
  res.json({ ok: true });
});

app.put("/api/menus/:id/shopping-list/items", (req, res) => {
  const dataScope = requestScope(res);
  const menuId = Number(req.params.id);
  const items = req.body.items;

  if (!Number.isInteger(menuId)) {
    res.status(400).json({ error: "A valid menu id is required." });
    return;
  }
  if (!getMenu(menuId, dataScope)) {
    res.status(404).json({ error: "Menu not found." });
    return;
  }

  if (!Array.isArray(items)) {
    res.status(400).json({ error: "Shopping list items must be an array." });
    return;
  }

  for (const item of items) {
    if (!Number.isInteger(Number(item.id))) {
      res.status(400).json({ error: "Shopping list items must include valid ids." });
      return;
    }
  }

  transaction(() => {
    for (const item of items) {
      run(
        `UPDATE menu_shopping_list_items
          SET text = ?, quantity = ?, unit = ?, item = ?, approved = ?
          WHERE id = ? AND menu_id = ?`,
        [
          item.text ?? "",
          item.quantity ?? "",
          item.unit ?? "",
          item.item ?? "",
          item.approved ? 1 : 0,
          Number(item.id),
          menuId
        ]
      );
    }
  });

  res.json({ ok: true, updated: items.length });
});

app.patch("/api/menus/:id/shopping-list/items/:itemId/approval", (req, res) => {
  const dataScope = requestScope(res);
  const menuId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  if (!Number.isInteger(menuId) || !Number.isInteger(itemId)) {
    res.status(400).json({ error: "Valid menu and shopping-list item ids are required." });
    return;
  }
  if (!getMenu(menuId, dataScope)) {
    res.status(404).json({ error: "Menu not found." });
    return;
  }
  if (typeof req.body.approved !== "boolean") {
    res.status(400).json({ error: "Approval must be true or false." });
    return;
  }

  const existing = queryOne<{ id: number }>(
    "SELECT id FROM menu_shopping_list_items WHERE id = ? AND menu_id = ?",
    [itemId, menuId]
  );
  if (!existing) {
    res.status(404).json({ error: "Shopping-list item not found for this menu." });
    return;
  }

  run("UPDATE menu_shopping_list_items SET approved = ? WHERE id = ? AND menu_id = ?", [
    req.body.approved ? 1 : 0,
    itemId,
    menuId
  ]);
  saveDb();
  res.json({ id: itemId, approved: req.body.approved ? 1 : 0 });
});

app.patch("/api/menus/:id/shopping-list/items/:itemId/source", (req, res) => {
  const dataScope = requestScope(res);
  const menuId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  if (!Number.isInteger(menuId) || !Number.isInteger(itemId)) {
    res.status(400).json({ error: "Valid menu and shopping-list item ids are required." });
    return;
  }
  if (!getMenu(menuId, dataScope)) {
    res.status(404).json({ error: "Menu not found." });
    return;
  }

  const item = String(req.body.item ?? "").trim();
  if (!item) {
    res.status(400).json({ error: "An item name is required before saving to its source." });
    return;
  }

  const shoppingItem = queryOne<{ id: number; quantity: string; unit: string }>(
    "SELECT id, quantity, unit FROM menu_shopping_list_items WHERE id = ? AND menu_id = ?",
    [itemId, menuId]
  );
  if (!shoppingItem) {
    res.status(404).json({ error: "Shopping-list item not found for this menu." });
    return;
  }

  const recipeSources = queryAll<{ recipeIngredientId: number; recipeId: number }>(
    `SELECT
      menu_shopping_list_item_recipe_sources.recipe_ingredient_id AS recipeIngredientId,
      recipe_ingredients.recipe_id AS recipeId
    FROM menu_shopping_list_item_recipe_sources
    JOIN menu_items
      ON menu_items.id = menu_shopping_list_item_recipe_sources.menu_item_id
      AND menu_items.menu_id = ?
    JOIN recipe_ingredients
      ON recipe_ingredients.id = menu_shopping_list_item_recipe_sources.recipe_ingredient_id
      AND recipe_ingredients.recipe_id = menu_items.recipe_id
    JOIN recipes ON recipes.id = recipe_ingredients.recipe_id
    WHERE menu_shopping_list_item_recipe_sources.menu_shopping_list_item_id = ?
      AND recipes.data_scope = ?`,
    [menuId, itemId, dataScope]
  );
  const customSources = queryAll<{ customShoppingListItemId: number; customShoppingListId: number }>(
    `SELECT
      custom_shopping_list_items.id AS customShoppingListItemId,
      custom_shopping_list_items.custom_shopping_list_id AS customShoppingListId
    FROM menu_shopping_list_item_custom_sources
    JOIN custom_shopping_list_items
      ON custom_shopping_list_items.id =
        menu_shopping_list_item_custom_sources.custom_shopping_list_item_id
    JOIN custom_shopping_lists
      ON custom_shopping_lists.id = custom_shopping_list_items.custom_shopping_list_id
    WHERE menu_shopping_list_item_custom_sources.menu_shopping_list_item_id = ?
      AND custom_shopping_lists.data_scope = ?`,
    [itemId, dataScope]
  );
  if (recipeSources.length + customSources.length !== 1) {
    res.status(409).json({
      error: recipeSources.length + customSources.length === 0
        ? "Re-aggregate this menu before saving changes to its source."
        : "Grouped or repeated items cannot be saved because they have multiple sources."
    });
    return;
  }

  transaction(() => {
    if (recipeSources.length === 1) {
      run(
        `UPDATE recipe_ingredients
        SET item = ?
        WHERE id = ? AND recipe_id = ?`,
        [item, recipeSources[0].recipeIngredientId, recipeSources[0].recipeId]
      );
      run("UPDATE recipes SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [recipeSources[0].recipeId]);
    } else {
      run(
        `UPDATE custom_shopping_list_items
        SET item = ?
        WHERE id = ? AND custom_shopping_list_id = ?`,
        [
          item,
          customSources[0].customShoppingListItemId,
          customSources[0].customShoppingListId
        ]
      );
      run(
        "UPDATE custom_shopping_lists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [customSources[0].customShoppingListId]
      );
    }
    run(
      `UPDATE menu_shopping_list_items
      SET text = ?, quantity = ?, unit = ?, item = ?
      WHERE id = ? AND menu_id = ?`,
      [item, shoppingItem.quantity, shoppingItem.unit, item, itemId, menuId]
    );
  });

  const updatedItem = getShoppingListItems(menuId, dataScope).find((candidate) => candidate.id === itemId);
  res.json({
    item: updatedItem,
    sourceType: recipeSources.length === 1 ? "recipe" : "custom",
    sourceId: recipeSources[0]?.recipeId ?? customSources[0].customShoppingListId
  });
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
