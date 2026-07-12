import express from "express";
import { randomUUID } from "node:crypto";
import { initializeDb, insert, queryAll, queryOne, run, saveDb, transaction } from "./db.js";
import {
  createCustomerAuthorizationUrl,
  exchangeCustomerAuthorizationCode,
  getQfcApiStatus,
  refreshCustomerToken,
  saveQfcApiSettings,
  searchLocations,
  searchProducts,
  submitToQfcCart
} from "./qfcAdapter.js";
import type { CartSubmissionProgress, CartSubmissionResult } from "./qfcAdapter.js";
import type { Recipe, RecipeInput } from "./types.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const port = 5174;

type QfcSubmitJob = {
  id: string;
  status: "running" | "complete" | "failed";
  progress: CartSubmissionProgress;
  result?: CartSubmissionResult;
  error?: string;
  createdAt: number;
};

const qfcSubmitJobs = new Map<string, QfcSubmitJob>();
const qfcSubmitJobTtlMs = 15 * 60 * 1000;

function pruneQfcSubmitJobs() {
  const cutoff = Date.now() - qfcSubmitJobTtlMs;
  for (const [jobId, job] of qfcSubmitJobs.entries()) {
    if (job.createdAt < cutoff) {
      qfcSubmitJobs.delete(jobId);
    }
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

type RecipeRow = Omit<Recipe, "ingredients" | "isTestData"> & {
  isTestData: number;
};

function getRecipe(id: number): Recipe | null {
  const recipe = queryOne(
    "SELECT id, name, category, is_test_data AS isTestData, servings, notes FROM recipes WHERE id = ?",
    [id]
  ) as
    | RecipeRow
    | null;

  if (!recipe) {
    return null;
  }

  const ingredients = queryAll(
      `SELECT
        id,
        recipe_id AS recipeId,
        text,
        quantity,
        unit,
        item,
        sort_order AS sortOrder
      FROM recipe_ingredients
      WHERE recipe_id = ?
      ORDER BY sort_order, id`,
      [id]
    ) as Recipe["ingredients"];

  return { ...recipe, isTestData: Boolean(recipe.isTestData), ingredients };
}

function validateRecipeInput(input: RecipeInput) {
  if (!input.name?.trim()) {
    throw new Error("Recipe name is required.");
  }
  if (!["entree", "vegetable_side", "starch_side"].includes(input.category)) {
    throw new Error("Recipe category is invalid.");
  }
  if (!Array.isArray(input.ingredients) || input.ingredients.length === 0) {
    throw new Error("At least one ingredient is required.");
  }
}

function parseQuantity(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length === 2) {
    const whole = Number(parts[0]);
    const fraction = parseQuantity(parts[1]);
    if (Number.isFinite(whole) && fraction !== null) {
      return whole + fraction;
    }
  }

  if (trimmed.includes("/")) {
    const [numerator, denominator] = trimmed.split("/").map(Number);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
      return numerator / denominator;
    }
  }

  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatQuantity(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  const commonFractions = [
    [0.25, "1/4"],
    [0.33, "1/3"],
    [0.5, "1/2"],
    [0.67, "2/3"],
    [0.75, "3/4"]
  ] as const;
  const whole = Math.floor(value);
  const remainder = value - whole;
  const match = commonFractions.find(([decimal]) => Math.abs(remainder - decimal) < 0.01);

  if (match) {
    return whole > 0 ? `${whole} ${match[1]}` : match[1];
  }

  return Number(value.toFixed(2)).toString();
}

function buildIngredientText(quantity: string, unit: string, item: string, fallback: string) {
  const parts = [quantity, unit, item].map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : fallback;
}

app.get("/api/recipes", (_req, res) => {
  const rows = queryAll(
      `SELECT
        id,
        name,
        category,
        is_test_data AS isTestData,
        servings,
        notes
      FROM recipes
      ORDER BY category, name`
    ) as RecipeRow[];

  res.json(rows.map((row) => getRecipe(row.id)));
});

app.post("/api/recipes", (req, res) => {
  try {
    const input = req.body as RecipeInput;
    validateRecipeInput(input);

    const createdRecipe = transaction(() => {
      const recipeId = insert("INSERT INTO recipes (name, category, is_test_data, servings, notes) VALUES (?, ?, ?, ?, ?)", [
        input.name.trim(),
        input.category,
        input.isTestData ? 1 : 0,
        input.servings ?? null,
        input.notes?.trim() ?? ""
      ]);

      input.ingredients.forEach((ingredient, index) => {
        run(
          `INSERT INTO recipe_ingredients
            (recipe_id, text, quantity, unit, item, sort_order)
          VALUES (?, ?, ?, ?, ?, ?)`,
          [
            recipeId,
          ingredient.text.trim(),
          ingredient.quantity?.trim() ?? "",
          ingredient.unit?.trim() ?? "",
          ingredient.item.trim(),
          index
          ]
        );
      });

      return getRecipe(recipeId);
    });

    res.status(201).json(createdRecipe);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid recipe." });
  }
});

app.get("/api/settings", (_req, res) => {
  const settings = queryAll("SELECT key, value FROM settings ORDER BY key") as Array<{
    key: string;
    value: string;
  }>;
  res.json(Object.fromEntries(settings.map(({ key, value }) => [key, value])));
});

app.put("/api/settings/:key", (req, res) => {
  const value = String(req.body.value ?? "");
  run(
    `INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ,
    [req.params.key, value]
  );
  saveDb();
  res.json({ key: req.params.key, value });
});

app.get("/api/qfc/status", (_req, res) => {
  res.json(getQfcApiStatus());
});

app.put("/api/qfc/settings", (req, res) => {
  res.json(saveQfcApiSettings({
    clientId: req.body.clientId,
    clientSecret: req.body.clientSecret,
    locationId: req.body.locationId,
    serviceScopes: req.body.serviceScopes,
    customerScopes: req.body.customerScopes,
    redirectUri: req.body.redirectUri
  }));
});

app.post("/api/qfc/oauth/start", (_req, res) => {
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

app.get("/api/qfc/products", async (req, res) => {
  try {
    const term = String(req.query.term ?? "");
    const limit = Number(req.query.limit ?? 10);
    const locationId = req.query.locationId ? String(req.query.locationId) : undefined;
    if (!term.trim()) {
      res.status(400).json({ error: "A product search term is required." });
      return;
    }

    res.json(await searchProducts(term, { locationId, limit }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to search products." });
  }
});

app.post("/api/menus/generate", (req, res) => {
  const mealCount = Number(req.body.mealCount ?? 5);
  const includeTestData = Boolean(req.body.includeTestData);
  if (!Number.isInteger(mealCount) || mealCount < 1 || mealCount > 14) {
    res.status(400).json({ error: "Meal count must be between 1 and 14." });
    return;
  }

  const recipes = queryAll("SELECT id, name, category FROM recipes WHERE is_test_data = ?", [
    includeTestData ? 1 : 0
  ]) as Array<{
    id: number;
    name: string;
    category: string;
  }>;

  const byCategory = {
    entree: recipes.filter((recipe) => recipe.category === "entree"),
    vegetable_side: recipes.filter((recipe) => recipe.category === "vegetable_side"),
    starch_side: recipes.filter((recipe) => recipe.category === "starch_side")
  };

  if (!byCategory.entree.length || !byCategory.vegetable_side.length || !byCategory.starch_side.length) {
    res.status(400).json({ error: "Add at least one recipe in each category before generating a menu." });
    return;
  }

  const pick = <T>(items: T[], index: number) => items[index % items.length];
  const menuName = `Week of ${new Date().toLocaleDateString("en-US")}`;

  const createdMenuId = transaction(() => {
    const menuId = insert("INSERT INTO menus (name, meal_count) VALUES (?, ?)", [menuName, mealCount]);

    for (let meal = 1; meal <= mealCount; meal += 1) {
      run("INSERT INTO menu_items (menu_id, meal_number, slot, recipe_id) VALUES (?, ?, ?, ?)", [
        menuId,
        meal,
        "entree",
        pick(byCategory.entree, meal - 1).id
      ]);
      run("INSERT INTO menu_items (menu_id, meal_number, slot, recipe_id) VALUES (?, ?, ?, ?)", [
        menuId,
        meal,
        "vegetable_side",
        pick(byCategory.vegetable_side, meal - 1).id
      ]);
      run("INSERT INTO menu_items (menu_id, meal_number, slot, recipe_id) VALUES (?, ?, ?, ?)", [
        menuId,
        meal,
        "starch_side",
        pick(byCategory.starch_side, meal - 1).id
      ]);
    }

    return menuId;
  });

  res.status(201).json({ id: createdMenuId });
});

app.get("/api/menus/:id", (req, res) => {
  const menu = queryOne("SELECT id, name, meal_count AS mealCount, status FROM menus WHERE id = ?", [req.params.id]);
  if (!menu) {
    res.status(404).json({ error: "Menu not found." });
    return;
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
      JOIN recipes ON recipes.id = menu_items.recipe_id
      WHERE menu_items.menu_id = ?
      ORDER BY menu_items.meal_number, menu_items.slot`,
      [req.params.id]
    );

  res.json({ ...menu, items });
});

app.put("/api/menu-items/:id", (req, res) => {
  run("UPDATE menu_items SET recipe_id = ? WHERE id = ?", [req.body.recipeId, req.params.id]);
  saveDb();
  res.json({ ok: true });
});

app.post("/api/menus/:id/aggregate", (req, res) => {
  const menuId = Number(req.params.id);
  const rows = queryAll(
      `SELECT
        recipe_ingredients.text,
        recipe_ingredients.quantity,
        recipe_ingredients.unit,
        recipe_ingredients.item,
        recipes.name AS recipeName
      FROM menu_items
      JOIN recipe_ingredients ON recipe_ingredients.recipe_id = menu_items.recipe_id
      JOIN recipes ON recipes.id = menu_items.recipe_id
      WHERE menu_items.menu_id = ?
      ORDER BY recipes.name, recipe_ingredients.sort_order`,
      [menuId]
    ) as Array<{
      text: string;
      quantity: string;
      unit: string;
      item: string;
      recipeName: string;
    }>;

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.item.trim() && row.unit.trim()
      ? `${row.item.trim().toLowerCase()}|${row.unit.trim().toLowerCase()}`
      : row.text.trim().toLowerCase();
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  transaction(() => {
    run("DELETE FROM shopping_list_items WHERE menu_id = ?", [menuId]);

    Array.from(grouped.values()).forEach((group, index) => {
      const first = group[0];
      const sources = Array.from(new Set(group.map((item) => item.recipeName))).join(", ");
      const parsedQuantities = group.map((item) => parseQuantity(item.quantity));
      const canSum = parsedQuantities.every((quantity) => quantity !== null);
      const quantity = canSum
        ? formatQuantity(parsedQuantities.reduce((sum, quantity) => sum + (quantity ?? 0), 0))
        : first.quantity;
      const text = canSum
        ? buildIngredientText(quantity, first.unit, first.item, first.text)
        : first.text;
      run(
        `INSERT INTO shopping_list_items
          (menu_id, text, quantity, unit, item, source_recipe_names, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [menuId, text, quantity, first.unit, first.item, sources, index]
      );
    });
  });

  res.status(201).json({ ok: true });
});

app.get("/api/menus/:id/shopping-list", (req, res) => {
  const rows = queryAll(
      `SELECT
        id,
        text,
        quantity,
        unit,
        item,
        source_recipe_names AS sourceRecipeNames,
        approved
      FROM shopping_list_items
      WHERE menu_id = ?
      ORDER BY sort_order, id`,
      [req.params.id]
    );
  res.json(rows);
});

app.delete("/api/menus/:id/shopping-list", (req, res) => {
  run("DELETE FROM shopping_list_items WHERE menu_id = ?", [req.params.id]);
  saveDb();
  res.json({ ok: true });
});

app.put("/api/shopping-list-items/:id", (req, res) => {
  run(
    `UPDATE shopping_list_items
      SET text = ?, quantity = ?, unit = ?, item = ?, approved = ?
      WHERE id = ?`
    ,
    [
    req.body.text ?? "",
    req.body.quantity ?? "",
    req.body.unit ?? "",
    req.body.item ?? "",
    req.body.approved ? 1 : 0,
    req.params.id
    ]
  );
  saveDb();
  res.json({ ok: true });
});

app.post("/api/menus/:id/submit-to-qfc", async (req, res) => {
  const rows = queryAll(
      `SELECT id, text, quantity, unit, item
      FROM shopping_list_items
      WHERE menu_id = ? AND approved = 1
      ORDER BY sort_order, id`,
      [req.params.id]
    ) as Array<{
      id: number;
      text: string;
      quantity: string;
      unit: string;
      item: string;
    }>;

  pruneQfcSubmitJobs();
  const jobId = randomUUID();
  const job: QfcSubmitJob = {
    id: jobId,
    status: "running",
    progress: {
      phase: "checking",
      processedItems: 0,
      totalItems: rows.length,
      message: "Starting QFC cart submission..."
    },
    createdAt: Date.now()
  };
  qfcSubmitJobs.set(jobId, job);

  void submitToQfcCart(rows, (progress) => {
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
      job.error = error instanceof Error ? error.message : "QFC cart submission failed.";
      job.progress = {
        phase: "complete",
        processedItems: rows.length,
        totalItems: rows.length,
        message: job.error
      };
    });

  res.status(202).json({ jobId, ...job });
});

app.get("/api/qfc/submit-jobs/:jobId", (req, res) => {
  pruneQfcSubmitJobs();
  const job = qfcSubmitJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "QFC submission job was not found." });
    return;
  }

  res.json(job);
});

await initializeDb();

app.listen(port, "127.0.0.1", () => {
  console.log(`Grocery Getter API running on http://127.0.0.1:${port}`);
});
