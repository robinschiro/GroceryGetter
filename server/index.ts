import express from "express";
import { randomUUID } from "node:crypto";
import { initializeDb, insert, queryAll, queryOne, run, saveDb, transaction } from "./db.js";
import {
  addQfcMatchesToCart,
  createCustomerAuthorizationUrl,
  exchangeCustomerAuthorizationCode,
  getQfcApiStatus,
  getStoreItemPreferences,
  refreshCustomerToken,
  saveQfcApiSettings,
  saveStoreItemPreference,
  searchLocations,
  previewQfcCart,
  searchStoreItems,
  deleteStoreItemPreference
} from "./qfcAdapter.js";
import type { CartSubmissionProgress, CartSubmissionResult } from "./qfcAdapter.js";
import type { Recipe, RecipeInput } from "./types.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const port = 5174;

type QfcSubmitJob = {
  id: string;
  kind: "preview" | "add";
  menuId: string;
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
  isTestData: number;
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
  isTestData: number;
  status: string;
};

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
    `SELECT
      id,
      name,
      category,
      is_test_data AS isTestData,
      servings,
      notes,
      source_path AS sourcePath,
      source_hash AS sourceHash,
      sync_status AS syncStatus
    FROM recipes
    WHERE id = ?`,
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

function getPlannerRecipes(includeTestData: boolean) {
  return queryAll("SELECT id, name, category, is_test_data AS isTestData FROM recipes WHERE is_test_data = ?", [
    includeTestData ? 1 : 0
  ]) as MenuRecipe[];
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

function buildMenuPreview(mealCount: number, includeTestData: boolean) {
  const byCategory = getRecipesByCategory(getPlannerRecipes(includeTestData));

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

  return {
    id: null,
    name: `Week of ${new Date().toLocaleDateString("en-US")}`,
    mealCount,
    isTestData: includeTestData,
    status: "preview",
    items
  };
}

function getMenu(menuId: number) {
  const menu = queryOne<MenuRow>(
    "SELECT id, name, meal_count AS mealCount, is_test_data AS isTestData, status FROM menus WHERE id = ?",
    [menuId]
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

  return { ...menu, isTestData: Boolean(menu.isTestData), items };
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

function getShoppingListItems(menuId: number) {
  return queryAll(
    `SELECT
      shopping_list_items.id,
      shopping_list_items.text,
      shopping_list_items.quantity,
      shopping_list_items.unit,
      shopping_list_items.item,
      shopping_list_items.source_recipe_names AS sourceRecipeNames,
      shopping_list_items.approved,
      (
        SELECT COUNT(*)
        FROM shopping_list_item_sources
        JOIN menu_items
          ON menu_items.id = shopping_list_item_sources.menu_item_id
          AND menu_items.menu_id = shopping_list_items.menu_id
        JOIN recipe_ingredients
          ON recipe_ingredients.id = shopping_list_item_sources.recipe_ingredient_id
          AND recipe_ingredients.recipe_id = menu_items.recipe_id
        WHERE shopping_list_item_sources.shopping_list_item_id = shopping_list_items.id
      ) AS sourceOccurrenceCount,
      CASE WHEN (
        SELECT COUNT(*)
        FROM shopping_list_item_sources
        JOIN menu_items
          ON menu_items.id = shopping_list_item_sources.menu_item_id
          AND menu_items.menu_id = shopping_list_items.menu_id
        JOIN recipe_ingredients
          ON recipe_ingredients.id = shopping_list_item_sources.recipe_ingredient_id
          AND recipe_ingredients.recipe_id = menu_items.recipe_id
        WHERE shopping_list_item_sources.shopping_list_item_id = shopping_list_items.id
      ) = 1 THEN 1 ELSE 0 END AS canPersistToRecipe
    FROM shopping_list_items
    WHERE shopping_list_items.menu_id = ?
    ORDER BY shopping_list_items.sort_order, shopping_list_items.id`,
    [menuId]
  );
}

app.get("/api/recipes", (_req, res) => {
  const rows = queryAll(
      `SELECT
        id,
        name,
        category,
        is_test_data AS isTestData,
        servings,
        notes,
        source_path AS sourcePath,
        source_hash AS sourceHash,
        sync_status AS syncStatus
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
      const recipeId = insert(
        `INSERT INTO recipes
          (name, category, is_test_data, servings, notes, source_path, source_hash, sync_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.name.trim(),
          input.category,
          input.isTestData ? 1 : 0,
          input.servings ?? null,
          input.notes?.trim() ?? "",
          input.sourcePath?.trim() || null,
          input.sourceHash?.trim() || null,
          input.syncStatus?.trim() || "manual"
        ]
      );

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

app.put("/api/recipes/:id", (req, res) => {
  try {
    const recipeId = Number(req.params.id);
    if (!Number.isInteger(recipeId)) {
      res.status(400).json({ error: "Recipe id is invalid." });
      return;
    }

    const existingRecipe = getRecipe(recipeId);
    if (!existingRecipe) {
      res.status(404).json({ error: "Recipe not found." });
      return;
    }

    const input = req.body as RecipeInput;
    validateRecipeInput(input);

    const updatedRecipe = transaction(() => {
      run(
        `UPDATE recipes
        SET
          name = ?,
          category = ?,
          is_test_data = ?,
          servings = ?,
          notes = ?,
          source_path = ?,
          source_hash = ?,
          sync_status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [
          input.name.trim(),
          input.category,
          input.isTestData ? 1 : 0,
          input.servings ?? null,
          input.notes?.trim() ?? "",
          input.sourcePath?.trim() || null,
          input.sourceHash?.trim() || null,
          input.syncStatus?.trim() || "manual",
          recipeId
        ]
      );
      run("DELETE FROM recipe_ingredients WHERE recipe_id = ?", [recipeId]);

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

    res.json(updatedRecipe);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid recipe." });
  }
});

app.delete("/api/recipes/:id", (req, res) => {
  try {
    const recipeId = Number(req.params.id);
    if (!Number.isInteger(recipeId)) {
      res.status(400).json({ error: "Recipe id is invalid." });
      return;
    }

    const existingRecipe = getRecipe(recipeId);
    if (!existingRecipe) {
      res.status(404).json({ error: "Recipe not found." });
      return;
    }

    transaction(() => {
      run("UPDATE menu_items SET recipe_id = NULL WHERE recipe_id = ?", [recipeId]);
      run("DELETE FROM recipes WHERE id = ?", [recipeId]);
    });

    res.json({ id: recipeId });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unable to delete recipe." });
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

app.get("/api/qfc/store-items", async (req, res) => {
  try {
    const term = String(req.query.term ?? "");
    const limit = Number(req.query.limit ?? 10);
    const locationId = req.query.locationId ? String(req.query.locationId) : undefined;
    if (!term.trim()) {
      res.status(400).json({ error: "A store item search term is required." });
      return;
    }

    res.json(await searchStoreItems(term, { locationId, limit }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to search store items." });
  }
});

app.get("/api/store-item-preferences", (_req, res) => {
  res.json(getStoreItemPreferences());
});

app.delete("/api/store-item-preferences/:provider/:ingredientKey", (req, res) => {
  deleteStoreItemPreference(req.params.provider, req.params.ingredientKey);
  res.json({ ok: true });
});

app.post("/api/menus/preview", (req, res) => {
  const mealCount = Number(req.body.mealCount ?? 5);
  const includeTestData = Boolean(req.body.includeTestData);
  if (!validateMealCount(mealCount)) {
    res.status(400).json({ error: "Meal count must be between 1 and 14." });
    return;
  }

  const preview = buildMenuPreview(mealCount, includeTestData);
  if (!preview) {
    res.status(400).json({ error: "Add at least one entree recipe before generating a menu." });
    return;
  }

  res.json(preview);
});

app.post("/api/menus", (req, res) => {
  const mealCount = Number(req.body.mealCount);
  const isTestData = Boolean(req.body.isTestData);
  const items = Array.isArray(req.body.items) ? req.body.items as MenuItemInput[] : [];
  if (!validateMealCount(mealCount)) {
    res.status(400).json({ error: "Meal count must be between 1 and 14." });
    return;
  }

  if (items.length !== mealCount * recipeCategories.length) {
    res.status(400).json({ error: "Saved menus must include one recipe for every meal slot." });
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

    const recipe = queryOne<{ category: RecipeCategory; isTestData: number }>(
      "SELECT category, is_test_data AS isTestData FROM recipes WHERE id = ?",
      [recipeId]
    );
    if (!recipe || recipe.category !== item.slot) {
      res.status(400).json({ error: "Menu items include a recipe that does not match its meal slot." });
      return;
    }
    if (Boolean(recipe.isTestData) !== isTestData) {
      res.status(400).json({ error: "Menu items must all match the saved menu recipe type." });
      return;
    }
  }

  const menuName = String(req.body.name || `Week of ${new Date().toLocaleDateString("en-US")}`);
  const createdMenuId = transaction(() => {
    const menuId = insert("INSERT INTO menus (name, meal_count, is_test_data) VALUES (?, ?, ?)", [
      menuName,
      mealCount,
      isTestData ? 1 : 0
    ]);
    for (const item of items) {
      run("INSERT INTO menu_items (menu_id, meal_number, slot, recipe_id) VALUES (?, ?, ?, ?)", [
        menuId,
        item.mealNumber,
        item.slot,
        item.recipeId
      ]);
    }
    return menuId;
  });

  res.status(201).json({ id: createdMenuId });
});

app.get("/api/menus/latest", (_req, res) => {
  const latest = queryOne<{ id: number }>("SELECT id FROM menus ORDER BY created_at DESC, id DESC LIMIT 1");
  res.json(latest ? getMenu(latest.id) : null);
});

app.get("/api/menus/:id", (req, res) => {
  const menuId = Number(req.params.id);
  const menu = Number.isInteger(menuId) ? getMenu(menuId) : null;
  if (!menu) {
    res.status(404).json({ error: "Menu not found." });
    return;
  }
  res.json(menu);
});

app.put("/api/menu-items/:id", (req, res) => {
  const menuItem = queryOne<{
    slot: RecipeCategory;
    isTestData: number;
  }>(
    `SELECT menu_items.slot, menus.is_test_data AS isTestData
    FROM menu_items
    JOIN menus ON menus.id = menu_items.menu_id
    WHERE menu_items.id = ?`,
    [req.params.id]
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
    const recipe = queryOne<{ category: RecipeCategory; isTestData: number }>(
      "SELECT category, is_test_data AS isTestData FROM recipes WHERE id = ?",
      [recipeId]
    );
    if (!recipe || recipe.category !== menuItem.slot) {
      res.status(400).json({ error: "Menu item includes a recipe that does not match its meal slot." });
      return;
    }
    if (Boolean(recipe.isTestData) !== Boolean(menuItem.isTestData)) {
      res.status(400).json({ error: "Menu item must match the saved menu recipe type." });
      return;
    }
  }

  run("UPDATE menu_items SET recipe_id = ? WHERE id = ?", [recipeId, req.params.id]);
  saveDb();
  res.json({ ok: true });
});

app.post("/api/menus/:id/aggregate", (req, res) => {
  const menuId = Number(req.params.id);
  const rows = queryAll(
      `SELECT
        menu_items.id AS menuItemId,
        recipe_ingredients.id AS recipeIngredientId,
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
      menuItemId: number;
      recipeIngredientId: number;
      text: string;
      quantity: string;
      unit: string;
      item: string;
      recipeName: string;
    }>;

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const normalizedItem = row.item.trim().toLowerCase();
    const normalizedUnit = row.unit.trim().toLowerCase();
    const key = normalizedItem
      ? `${normalizedItem}|${normalizedUnit}`
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
      const shoppingListItemId = insert(
        `INSERT INTO shopping_list_items
          (menu_id, text, quantity, unit, item, source_recipe_names, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [menuId, text, quantity, first.unit, first.item, sources, index]
      );
      group.forEach((source) => {
        run(
          `INSERT INTO shopping_list_item_sources
            (shopping_list_item_id, menu_item_id, recipe_ingredient_id)
          VALUES (?, ?, ?)`,
          [shoppingListItemId, source.menuItemId, source.recipeIngredientId]
        );
      });
    });
  });

  res.status(201).json({ ok: true });
});

app.get("/api/menus/:id/shopping-list", (req, res) => {
  const menuId = Number(req.params.id);
  if (!Number.isInteger(menuId)) {
    res.status(400).json({ error: "A valid menu id is required." });
    return;
  }
  res.json(getShoppingListItems(menuId));
});

app.delete("/api/menus/:id/shopping-list", (req, res) => {
  run("DELETE FROM shopping_list_items WHERE menu_id = ?", [req.params.id]);
  saveDb();
  res.json({ ok: true });
});

app.put("/api/menus/:id/shopping-list/items", (req, res) => {
  const menuId = Number(req.params.id);
  const items = req.body.items;

  if (!Number.isInteger(menuId)) {
    res.status(400).json({ error: "A valid menu id is required." });
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
        `UPDATE shopping_list_items
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
  const menuId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  if (!Number.isInteger(menuId) || !Number.isInteger(itemId)) {
    res.status(400).json({ error: "Valid menu and shopping-list item ids are required." });
    return;
  }
  if (typeof req.body.approved !== "boolean") {
    res.status(400).json({ error: "Approval must be true or false." });
    return;
  }

  const existing = queryOne<{ id: number }>(
    "SELECT id FROM shopping_list_items WHERE id = ? AND menu_id = ?",
    [itemId, menuId]
  );
  if (!existing) {
    res.status(404).json({ error: "Shopping-list item not found for this menu." });
    return;
  }

  run("UPDATE shopping_list_items SET approved = ? WHERE id = ? AND menu_id = ?", [
    req.body.approved ? 1 : 0,
    itemId,
    menuId
  ]);
  saveDb();
  res.json({ id: itemId, approved: req.body.approved ? 1 : 0 });
});

app.patch("/api/menus/:id/shopping-list/items/:itemId/source-ingredient", (req, res) => {
  const menuId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  if (!Number.isInteger(menuId) || !Number.isInteger(itemId)) {
    res.status(400).json({ error: "Valid menu and shopping-list item ids are required." });
    return;
  }

  const item = String(req.body.item ?? "").trim();
  const quantity = String(req.body.quantity ?? "").trim();
  const unit = String(req.body.unit ?? "").trim();
  const text = String(req.body.text ?? "").trim() || buildIngredientText(quantity, unit, item, "");
  if (!item) {
    res.status(400).json({ error: "Ingredient item is required before saving to a recipe." });
    return;
  }

  const shoppingItem = queryOne<{ id: number }>(
    "SELECT id FROM shopping_list_items WHERE id = ? AND menu_id = ?",
    [itemId, menuId]
  );
  if (!shoppingItem) {
    res.status(404).json({ error: "Shopping-list item not found for this menu." });
    return;
  }

  const sources = queryAll<{ recipeIngredientId: number; recipeId: number }>(
    `SELECT
      shopping_list_item_sources.recipe_ingredient_id AS recipeIngredientId,
      recipe_ingredients.recipe_id AS recipeId
    FROM shopping_list_item_sources
    JOIN menu_items
      ON menu_items.id = shopping_list_item_sources.menu_item_id
      AND menu_items.menu_id = ?
    JOIN recipe_ingredients
      ON recipe_ingredients.id = shopping_list_item_sources.recipe_ingredient_id
      AND recipe_ingredients.recipe_id = menu_items.recipe_id
    WHERE shopping_list_item_sources.shopping_list_item_id = ?`,
    [menuId, itemId]
  );
  if (sources.length !== 1) {
    res.status(409).json({
      error: sources.length === 0
        ? "Re-aggregate this menu before saving ingredient metadata to a recipe."
        : "Grouped or repeated ingredients cannot be saved back to a recipe."
    });
    return;
  }

  transaction(() => {
    run(
      `UPDATE recipe_ingredients
      SET text = ?, quantity = ?, unit = ?, item = ?
      WHERE id = ? AND recipe_id = ?`,
      [text, quantity, unit, item, sources[0].recipeIngredientId, sources[0].recipeId]
    );
    run("UPDATE recipes SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [sources[0].recipeId]);
    run(
      `UPDATE shopping_list_items
      SET text = ?, quantity = ?, unit = ?, item = ?
      WHERE id = ? AND menu_id = ?`,
      [text, quantity, unit, item, itemId, menuId]
    );
  });

  const updatedItem = getShoppingListItems(menuId).find((candidate) => candidate.id === itemId);
  res.json({ item: updatedItem, recipeId: sources[0].recipeId });
});

app.post("/api/menus/:id/preview-qfc", async (req, res) => {
  const menuId = req.params.id;
  const rows = queryAll(
      `SELECT id, text, quantity, unit, item, source_recipe_names AS sourceRecipeNames, approved
      FROM shopping_list_items
      WHERE menu_id = ? AND approved = 1
      ORDER BY sort_order, id`,
      [menuId]
    ) as Array<{
      id: number;
      text: string;
      quantity: string;
      unit: string;
      item: string;
      sourceRecipeNames: string;
      approved: number;
    }>;

  pruneQfcSubmitJobs();
  const jobId = randomUUID();
  const job: QfcSubmitJob = {
    id: jobId,
    kind: "preview",
    menuId,
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

  void previewQfcCart(rows, (progress) => {
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
  const previewJob = qfcSubmitJobs.get(req.params.jobId);
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
  const preference = saveStoreItemPreference("kroger", ingredientName, storeItem);
  match.storeItem = storeItem;
  match.selectionSource = "remembered";
  res.json({ match, preference });
});

app.put("/api/store-item-reviews/:jobId/quantities/:shoppingItemId", (req, res) => {
  pruneQfcSubmitJobs();
  const previewJob = qfcSubmitJobs.get(req.params.jobId);
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
  const previewJob = qfcSubmitJobs.get(req.params.jobId);
  if (!previewJob || previewJob.kind !== "preview" || previewJob.status !== "complete" || !previewJob.result) {
    res.status(409).json({ error: "The store item review is unavailable or incomplete. Preview the store items again." });
    return;
  }

  const shoppingItemId = Number(req.params.shoppingItemId);
  const matches = previewJob.result.matched ?? [];
  const skipped = previewJob.result.skipped ?? [];
  let match = matches.find((candidateMatch) => candidateMatch.item.id === shoppingItemId);
  const skip = skipped.find((candidateSkip) => candidateSkip.item.id === shoppingItemId);
  if (!match && !skip) {
    res.status(404).json({ error: "The ingredient was not found in this store item review." });
    return;
  }

  const term = String(req.body.term ?? "").trim();
  if (!term) {
    res.status(400).json({ error: "Enter a search term to find store items." });
    return;
  }

  try {
    const results = await searchStoreItems(term, { limit: 20 });
    const candidateKeys = new Set<string>();
    const candidates = results.filter((candidate) => {
      const key = `${candidate.productId}\u0000${candidate.upc}`;
      if (candidateKeys.has(key)) return false;
      candidateKeys.add(key);
      return true;
    });

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
    }

    res.json({
      match: match ?? null,
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
  const previewJob = qfcSubmitJobs.get(req.params.jobId);
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
  const previewJob = qfcSubmitJobs.get(req.params.jobId);
  if (!previewJob || previewJob.kind !== "preview" || previewJob.status !== "complete" || !previewJob.result) {
    res.status(409).json({ error: "The store item review is unavailable or incomplete. Preview the store items again." });
    return;
  }

  const jobId = randomUUID();
  const job: QfcSubmitJob = {
    id: jobId,
    kind: "add",
    menuId: previewJob.menuId,
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
        run("UPDATE menus SET status = 'submitted', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [job.menuId]);
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
