import { expect, test } from "playwright/test";
import {
  productionHeaders,
  resetDatabase,
  sandboxHeaders
} from "../fixtures/characterization.js";

test.beforeEach(async ({ request }) => {
  await resetDatabase(request);
});

test("recipes preserve CRUD, validation, ordering, generation, and scope behavior", async ({ request }) => {
  const production = await request.get("/api/recipes", { headers: productionHeaders });
  expect(production.status()).toBe(200);
  const initialRecipes = await production.json();
  expect(initialRecipes).toHaveLength(53);
  expect(initialRecipes.every((recipe: { dataScope: string }) => recipe.dataScope === "production")).toBeTruthy();

  const sandbox = await request.get("/api/recipes", { headers: sandboxHeaders });
  expect((await sandbox.json()).map((recipe: { name: string }) => recipe.name)).toEqual(["Sandbox Tacos"]);

  const invalidScope = await request.get("/api/recipes", { headers: { "X-Data-Scope": "wrong" } });
  expect(invalidScope.status()).toBe(400);
  expect(await invalidScope.json()).toEqual({ error: "Data scope must be production or sandbox." });

  const invalid = await request.post("/api/recipes", {
    headers: productionHeaders,
    data: { name: "", category: "entree", ingredients: [] }
  });
  expect(invalid.status()).toBe(400);
  expect(await invalid.json()).toEqual({ error: "Recipe name is required." });

  const createdResponse = await request.post("/api/recipes", {
    headers: productionHeaders,
    data: {
      name: "  Characterized Soup  ",
      category: "entree",
      includeInMenuGeneration: false,
      servings: 6,
      notes: "  API fixture  ",
      ingredients: [
        { text: "2 onions", quantity: "2", unit: "", item: "onions" },
        { text: "1 stock carton", quantity: "1", unit: "carton", item: "stock" }
      ]
    }
  });
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json();
  expect(created).toMatchObject({
    name: "Characterized Soup",
    includeInMenuGeneration: false,
    servings: 6,
    notes: "API fixture"
  });
  expect(created.ingredients.map((ingredient: { item: string; sortOrder: number }) => [
    ingredient.item,
    ingredient.sortOrder
  ])).toEqual([["onions", 0], ["stock", 1]]);

  const toggled = await request.patch(`/api/recipes/${created.id}/menu-generation`, {
    headers: productionHeaders,
    data: { includeInMenuGeneration: true }
  });
  expect(toggled.status()).toBe(200);
  expect((await toggled.json()).includeInMenuGeneration).toBe(true);

  const updated = await request.put(`/api/recipes/${created.id}`, {
    headers: productionHeaders,
    data: {
      name: "Characterized Stew",
      category: "entree",
      includeInMenuGeneration: true,
      ingredients: [
        { text: "1 stock carton", quantity: "1", unit: "carton", item: "stock" },
        { text: "3 onions", quantity: "3", unit: "", item: "onions" }
      ]
    }
  });
  expect(updated.status()).toBe(200);
  expect((await updated.json()).ingredients.map((ingredient: { item: string }) => ingredient.item))
    .toEqual(["stock", "onions"]);

  expect((await request.put(`/api/recipes/${created.id}`, {
    headers: sandboxHeaders,
    data: {
      name: "Cross scope",
      category: "entree",
      ingredients: [{ text: "1 item", item: "item" }]
    }
  })).status()).toBe(404);
  expect((await request.put("/api/recipes/not-a-number", {
    headers: productionHeaders,
    data: {}
  })).status()).toBe(400);

  expect((await request.delete(`/api/recipes/${created.id}`, { headers: productionHeaders })).status()).toBe(200);
  expect((await request.delete(`/api/recipes/${created.id}`, { headers: productionHeaders })).status()).toBe(404);
});

test("reusable shopping lists preserve conflicts, ordering, defaults, edits, deletes, and scope", async ({ request }) => {
  const initial = await request.get("/api/custom-shopping-lists", { headers: productionHeaders });
  const [weekly] = await initial.json();
  expect(weekly).toMatchObject({ name: "Weekly Staples", includeInMenuByDefault: true });
  expect(weekly.items.map((item: { item: string }) => item.item))
    .toEqual(["tomato", "milk", "preferred unavailable item", "unmatched item"]);

  const invalid = await request.post("/api/custom-shopping-lists", {
    headers: productionHeaders,
    data: { name: "Empty", items: [] }
  });
  expect(invalid.status()).toBe(400);
  expect((await invalid.json()).error).toContain("At least one");

  const duplicate = await request.post("/api/custom-shopping-lists", {
    headers: productionHeaders,
    data: {
      name: "weekly staples",
      items: [{ text: "1 duplicate", quantity: "1", unit: "", item: "duplicate" }]
    }
  });
  expect(duplicate.status()).toBe(400);
  expect((await duplicate.json()).error).toContain("UNIQUE");

  const createdResponse = await request.post("/api/custom-shopping-lists", {
    headers: productionHeaders,
    data: {
      name: "Party",
      includeInMenuByDefault: false,
      items: [
        { text: "2 soda", quantity: "2", unit: "", item: "soda" },
        { text: "1 chips", quantity: "1", unit: "", item: "chips" }
      ]
    }
  });
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json();

  const updatedResponse = await request.put(`/api/custom-shopping-lists/${created.id}`, {
    headers: productionHeaders,
    data: {
      name: "Party Supplies",
      includeInMenuByDefault: true,
      items: [
        { ...created.items[1], text: "3 chips", quantity: "3" },
        { ...created.items[0] }
      ]
    }
  });
  expect(updatedResponse.status()).toBe(200);
  const updated = await updatedResponse.json();
  expect(updated).toMatchObject({ name: "Party Supplies", includeInMenuByDefault: true });
  expect(updated.items.map((item: { item: string; sortOrder: number }) => [item.item, item.sortOrder]))
    .toEqual([["chips", 0], ["soda", 1]]);

  expect((await request.get("/api/custom-shopping-lists", { headers: sandboxHeaders })).status()).toBe(200);
  expect((await request.put(`/api/custom-shopping-lists/${created.id}`, {
    headers: sandboxHeaders,
    data: { name: "Nope", items: [{ text: "1 nope", item: "nope" }] }
  })).status()).toBe(404);
  expect((await request.delete(`/api/custom-shopping-lists/${created.id}`, {
    headers: productionHeaders
  })).status()).toBe(200);
  expect((await request.delete(`/api/custom-shopping-lists/${created.id}`, {
    headers: productionHeaders
  })).status()).toBe(404);
});
