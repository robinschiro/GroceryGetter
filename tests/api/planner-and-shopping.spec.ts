import { expect, test, type APIRequestContext } from "playwright/test";
import { parseOurGroceriesItems } from "../../server/infrastructure/ourGroceries/ourGroceriesService.js";
import {
  productionHeaders,
  resetDatabase,
  sandboxHeaders
} from "../fixtures/characterization.js";

test.beforeEach(async ({ request }) => {
  await resetDatabase(request);
});

async function createMenu(request: APIRequestContext, mealCount = 1) {
  const previewResponse = await request.post("/api/menus/preview", {
    headers: productionHeaders,
    data: { mealCount }
  });
  expect(previewResponse.status()).toBe(200);
  const preview = await previewResponse.json();
  expect(preview.items).toHaveLength(mealCount * 3);
  expect(preview.items.filter((item: { slot: string }) => item.slot === "entree")
    .every((item: { recipeId: number | null }) => Number.isInteger(item.recipeId))).toBeTruthy();

  const savedResponse = await request.post("/api/menus", {
    headers: productionHeaders,
    data: {
      name: "Characterized Week",
      mealCount,
      items: preview.items,
      customShoppingListIds: preview.customShoppingListIds,
      ourGroceriesListId: preview.ourGroceriesList?.id ?? null
    }
  });
  expect(savedResponse.status()).toBe(201);
  return { id: (await savedResponse.json()).id as number, preview };
}

test("OurGroceries defaults are scope-specific and saved menus retain their selection", async ({ request }) => {
  const listsResponse = await request.get("/api/ourgroceries/lists", { headers: productionHeaders });
  expect(listsResponse.status()).toBe(200);
  const lists = await listsResponse.json() as Array<{ id: string; name: string; webUrl: string }>;
  const costco = lists.find((list) => list.name === "Costco")!;
  const weekly = lists.find((list) => list.name === "OurGroceries Weekly")!;
  expect(costco.webUrl).toContain("ourgroceries.com/your-lists/");

  expect((await request.put("/api/ourgroceries/default-list", {
    headers: productionHeaders,
    data: { listId: costco.id }
  })).status()).toBe(200);
  expect((await request.put("/api/ourgroceries/default-list", {
    headers: sandboxHeaders,
    data: { listId: weekly.id }
  })).status()).toBe(200);

  const productionPreview = await (await request.post("/api/menus/preview", {
    headers: productionHeaders,
    data: { mealCount: 1 }
  })).json();
  const sandboxPreview = await (await request.post("/api/menus/preview", {
    headers: sandboxHeaders,
    data: { mealCount: 1 }
  })).json();
  expect(productionPreview.ourGroceriesList).toEqual(costco);
  expect(sandboxPreview.ourGroceriesList).toEqual(weekly);

  const savedResponse = await request.post("/api/menus", {
    headers: productionHeaders,
    data: {
      name: "Remote list week",
      mealCount: 1,
      items: productionPreview.items,
      customShoppingListIds: [],
      ourGroceriesListId: costco.id
    }
  });
  expect(savedResponse.status()).toBe(201);
  const menuId = (await savedResponse.json()).id as number;

  await request.put("/api/ourgroceries/default-list", {
    headers: productionHeaders,
    data: { listId: weekly.id }
  });
  expect((await (await request.get(`/api/menus/${menuId}`, {
    headers: productionHeaders
  })).json()).ourGroceriesList).toEqual(costco);

  const deselected = await request.put(`/api/menus/${menuId}/ourgroceries-list`, {
    headers: productionHeaders,
    data: { listId: null }
  });
  expect(deselected.status()).toBe(200);
  expect((await deselected.json()).ourGroceriesList).toBeNull();
  expect((await request.put(`/api/menus/${menuId}/ourgroceries-list`, {
    headers: productionHeaders,
    data: { listId: "missing-list" }
  })).status()).toBe(400);
});

test("OurGroceries response parsing marks items with crossedOffAt as crossed off", () => {
  expect(parseOurGroceriesItems({
    list: {
      items: [
        { id: "active", value: "milk" },
        { id: "crossed-timestamp", value: "bread", crossedOffAt: 1_785_831_234_567 },
        { id: "crossed-string", value: "eggs", crossedOffAt: "2026-08-04T12:00:00Z" }
      ]
    }
  })).toEqual([
    { id: "active", name: "milk", crossedOff: false },
    { id: "crossed-timestamp", name: "bread", crossedOff: true },
    { id: "crossed-string", name: "eggs", crossedOff: true }
  ]);
});

test("OurGroceries active items aggregate with remote provenance and remain read-only", async ({ request }) => {
  const lists = await (await request.get("/api/ourgroceries/lists", {
    headers: productionHeaders
  })).json() as Array<{ id: string; name: string; webUrl: string }>;
  const costco = lists.find((list) => list.name === "Costco")!;
  const { id } = await createMenu(request, 1);
  expect((await request.put(`/api/menus/${id}/ourgroceries-list`, {
    headers: productionHeaders,
    data: { listId: costco.id }
  })).status()).toBe(200);

  expect((await request.post(`/api/menus/${id}/aggregate`, {
    headers: productionHeaders
  })).status()).toBe(201);
  const items = await (await request.get(`/api/menus/${id}/shopping-list`, {
    headers: productionHeaders
  })).json();
  expect(items.some((item: { item: string }) => item.item === "already bought")).toBeFalsy();

  const coffee = items.find((item: { item: string }) => item.item === "coffee");
  expect(coffee).toMatchObject({ text: "coffee", quantity: "", unit: "", canPersistToSource: 0 });
  expect(coffee.sourceTargets).toEqual([
    { type: "ourGroceries", id: costco.id, name: "Costco", webUrl: costco.webUrl }
  ]);
  expect(coffee.sourceDetails).toEqual([
    expect.objectContaining({ type: "ourGroceries", id: costco.id, text: "coffee", webUrl: costco.webUrl })
  ]);
  expect((await request.patch(`/api/menus/${id}/shopping-list/items/${coffee.id}/source`, {
    headers: productionHeaders,
    data: { item: "different coffee" }
  })).status()).toBe(409);

  const tomato = items.find((item: { item: string }) => item.item === "tomato");
  expect(tomato.sourceTargets).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "ourGroceries", id: costco.id, webUrl: costco.webUrl }),
    expect.objectContaining({ type: "recipe" })
  ]));
});

test("planner preserves generation, saving, latest loading, replacement, empty sides, and meal changes", async ({ request }) => {
  expect((await request.post("/api/menus/preview", {
    headers: productionHeaders,
    data: { mealCount: 0 }
  })).status()).toBe(400);

  const { id, preview } = await createMenu(request, 2);
  const latest = await request.get("/api/menus/latest", { headers: productionHeaders });
  expect(latest.status()).toBe(200);
  expect(await latest.json()).toMatchObject({
    id,
    name: "Characterized Week",
    mealCount: 2,
    customShoppingListIds: preview.customShoppingListIds
  });
  expect(await (await request.get("/api/menus/latest", { headers: sandboxHeaders })).json()).toBeNull();
  expect((await request.get(`/api/menus/${id}`, { headers: sandboxHeaders })).status()).toBe(404);

  const menu = await (await request.get(`/api/menus/${id}`, { headers: productionHeaders })).json();
  const vegetable = menu.items.find((item: { slot: string }) => item.slot === "vegetable_side");
  const alternateVegetable = (await (await request.get("/api/recipes", { headers: productionHeaders })).json())
    .find((recipe: { category: string }) => recipe.category === "vegetable_side");
  expect((await request.put(`/api/menu-items/${vegetable.id}`, {
    headers: productionHeaders,
    data: { recipeId: null }
  })).status()).toBe(200);
  expect((await request.put(`/api/menu-items/${vegetable.id}`, {
    headers: productionHeaders,
    data: { recipeId: alternateVegetable.id }
  })).status()).toBe(200);

  const entree = menu.items.find((item: { slot: string }) => item.slot === "entree");
  expect((await request.put(`/api/menu-items/${entree.id}`, {
    headers: productionHeaders,
    data: { recipeId: null }
  })).status()).toBe(400);

  const added = await request.post(`/api/menus/${id}/meals`, {
    headers: productionHeaders,
    data: { items: preview.items.slice(0, 3) }
  });
  expect(added.status()).toBe(201);
  expect((await added.json()).mealCount).toBe(3);

  const removed = await request.delete(`/api/menus/${id}/meals/2`, { headers: productionHeaders });
  expect(removed.status()).toBe(200);
  expect((await removed.json()).mealCount).toBe(2);

  expect((await request.put(`/api/menus/${id}/custom-shopping-lists`, {
    headers: productionHeaders,
    data: { customShoppingListIds: [] }
  })).status()).toBe(200);
  expect((await request.put(`/api/menus/${id}/custom-shopping-lists`, {
    headers: productionHeaders,
    data: { customShoppingListIds: [999999] }
  })).status()).toBe(400);
});

test("menu history is scope-isolated, newest-first, and safely deletes menus", async ({ request }) => {
  const first = await createMenu(request, 1);
  const preview = await (await request.post("/api/menus/preview", {
    headers: productionHeaders,
    data: { mealCount: 2 }
  })).json();
  const secondResponse = await request.post("/api/menus", {
    headers: productionHeaders,
    data: {
      name: "Newest Week",
      mealCount: 2,
      items: preview.items,
      customShoppingListIds: preview.customShoppingListIds
    }
  });
  expect(secondResponse.status()).toBe(201);
  const secondId = (await secondResponse.json()).id as number;

  const historyResponse = await request.get("/api/menus", { headers: productionHeaders });
  expect(historyResponse.status()).toBe(200);
  expect(await historyResponse.json()).toEqual([
    expect.objectContaining({
      id: secondId,
      name: "Newest Week",
      mealCount: 2,
      status: "draft",
      createdAt: expect.any(String),
      updatedAt: expect.any(String)
    }),
    expect.objectContaining({
      id: first.id,
      name: "Characterized Week",
      mealCount: 1
    })
  ]);

  const sandboxHistory = await request.get("/api/menus", { headers: sandboxHeaders });
  expect(sandboxHistory.status()).toBe(200);
  expect(await sandboxHistory.json()).toEqual([]);

  expect((await request.delete(`/api/menus/${secondId}`, {
    headers: sandboxHeaders
  })).status()).toBe(404);
  const deleteResponse = await request.delete(`/api/menus/${secondId}`, {
    headers: productionHeaders
  });
  expect(deleteResponse.status()).toBe(200);
  expect(await deleteResponse.json()).toEqual({ id: secondId });
  expect((await request.get(`/api/menus/${secondId}`, {
    headers: productionHeaders
  })).status()).toBe(404);
  expect((await request.delete(`/api/menus/${secondId}`, {
    headers: productionHeaders
  })).status()).toBe(404);

  const remainingHistory = await request.get("/api/menus", { headers: productionHeaders });
  expect((await remainingHistory.json()).map((menu: { id: number }) => menu.id)).toEqual([first.id]);
});

test("shopping-list aggregation preserves grouping, provenance, approval, dirty saves, source saves, clear, and regeneration", async ({ request }) => {
  const { id } = await createMenu(request, 1);
  const aggregate = await request.post(`/api/menus/${id}/aggregate`, { headers: productionHeaders });
  expect(aggregate.status()).toBe(201);

  let items = await (await request.get(`/api/menus/${id}/shopping-list`, {
    headers: productionHeaders
  })).json();
  const tomato = items.find((item: { item: string }) => item.item === "tomato");
  expect(["3", "4"]).toContain(tomato.quantity);
  expect(tomato.approved).toBe(1);
  expect(tomato.sourceNames).toContain("Weekly Staples");
  expect(tomato.sourceTargets.length).toBeGreaterThan(1);
  expect(tomato.sourceDetails).toEqual(expect.arrayContaining([
    expect.objectContaining({
      type: "shoppingList",
      name: "Weekly Staples",
      quantity: "1",
      unit: ""
    })
  ]));
  expect(tomato.sourceDetails.length).toBe(tomato.sourceOccurrenceCount);

  const unique = items.find((item: { item: string; sourceTargets: unknown[] }) => item.sourceTargets.length === 1);
  const approval = await request.patch(`/api/menus/${id}/shopping-list/items/${unique.id}/approval`, {
    headers: productionHeaders,
    data: { approved: false }
  });
  expect(approval.status()).toBe(200);
  expect((await approval.json()).approved).toBe(0);

  const edited = items.map((item: { id: number }) =>
    item.id === unique.id ? { ...item, item: "characterized item", text: "characterized item", approved: 1 } : item
  );
  expect((await request.put(`/api/menus/${id}/shopping-list/items`, {
    headers: productionHeaders,
    data: { items: edited }
  })).status()).toBe(200);
  const sourceSave = await request.patch(`/api/menus/${id}/shopping-list/items/${unique.id}/source`, {
    headers: productionHeaders,
    data: { item: "characterized source item" }
  });
  expect(sourceSave.status()).toBe(200);
  expect((await sourceSave.json()).item.item).toBe("characterized source item");

  expect((await request.patch(`/api/menus/${id}/shopping-list/items/${tomato.id}/source`, {
    headers: productionHeaders,
    data: { item: "grouped tomato" }
  })).status()).toBe(409);

  const tomatoRecipeSource = tomato.sourceTargets.find(
    (source: { type: string }) => source.type === "recipe"
  );
  const recipes = await (await request.get("/api/recipes", {
    headers: productionHeaders
  })).json();
  const sourceRecipe = recipes.find(
    (recipe: { id: number }) => recipe.id === tomatoRecipeSource.id
  );
  expect((await request.put(`/api/recipes/${sourceRecipe.id}`, {
    headers: productionHeaders,
    data: sourceRecipe
  })).status()).toBe(200);
  const afterRecipeEdit = await (await request.get(`/api/menus/${id}/shopping-list`, {
    headers: productionHeaders
  })).json();
  const tomatoAfterRecipeEdit = afterRecipeEdit.find(
    (item: { id: number }) => item.id === tomato.id
  );
  expect(tomatoAfterRecipeEdit.sourceTargets).toEqual(expect.arrayContaining([
    expect.objectContaining({
      type: "recipe",
      id: sourceRecipe.id,
      name: sourceRecipe.name
    })
  ]));
  expect(tomatoAfterRecipeEdit.sourceDetails.length)
    .toBe(tomatoAfterRecipeEdit.sourceOccurrenceCount);

  expect((await request.get(`/api/menus/${id}/shopping-list`, { headers: sandboxHeaders })).status()).toBe(404);
  expect((await request.get("/api/menus/not-a-number/shopping-list", {
    headers: productionHeaders
  })).status()).toBe(400);

  expect((await request.delete(`/api/menus/${id}/shopping-list`, { headers: productionHeaders })).status()).toBe(200);
  items = await (await request.get(`/api/menus/${id}/shopping-list`, { headers: productionHeaders })).json();
  expect(items).toEqual([]);
  expect((await request.post(`/api/menus/${id}/aggregate`, { headers: productionHeaders })).status()).toBe(201);
  expect((await (await request.get(`/api/menus/${id}/shopping-list`, {
    headers: productionHeaders
  })).json()).length).toBeGreaterThan(0);
});

test("OurGroceries connection controls are production-only and stale defaults are reported", async ({ request }) => {
  const lists = await (await request.get("/api/ourgroceries/lists", {
    headers: productionHeaders
  })).json() as Array<{ id: string }>;
  await request.put("/api/ourgroceries/default-list", {
    headers: productionHeaders,
    data: { listId: lists[0].id }
  });
  const { id: menuId } = await createMenu(request, 1);
  expect((await request.post(`/api/menus/${menuId}/aggregate`, {
    headers: productionHeaders
  })).status()).toBe(201);
  const originalSnapshot = await (await request.get(`/api/menus/${menuId}/shopping-list`, {
    headers: productionHeaders
  })).json();

  expect((await request.put("/api/ourgroceries/connection", {
    headers: sandboxHeaders,
    data: { email: "test@example.com", password: "secret-value" }
  })).status()).toBe(403);
  const connection = await request.put("/api/ourgroceries/connection", {
    headers: productionHeaders,
    data: { email: "test@example.com", password: "secret-value" }
  });
  expect(connection.status()).toBe(200);
  expect(JSON.stringify(await connection.json())).not.toContain("secret-value");
  const connectedStatus = await (await request.get("/api/ourgroceries/status", {
    headers: productionHeaders
  })).json();
  expect(connectedStatus).toMatchObject({
    connected: true,
    hasStoredCredentials: true,
    accountLabel: "te**@example.com"
  });
  expect(JSON.stringify(connectedStatus)).not.toContain("secret-value");
  expect((await request.delete("/api/ourgroceries/connection", {
    headers: sandboxHeaders
  })).status()).toBe(403);
  expect((await request.delete("/api/ourgroceries/connection", {
    headers: productionHeaders
  })).status()).toBe(200);
  expect((await request.post(`/api/menus/${menuId}/aggregate`, {
    headers: productionHeaders
  })).status()).toBe(502);
  expect(await (await request.get(`/api/menus/${menuId}/shopping-list`, {
    headers: productionHeaders
  })).json()).toEqual(originalSnapshot);

  const status = await (await request.get("/api/ourgroceries/status", {
    headers: productionHeaders
  })).json();
  expect(status).toMatchObject({
    connected: false,
    hasStoredCredentials: false,
    defaultList: expect.objectContaining({ id: lists[0].id }),
    defaultListAvailable: false
  });
  const disconnectedPreview = await (await request.post("/api/menus/preview", {
    headers: productionHeaders,
    data: { mealCount: 1 }
  })).json();
  expect(disconnectedPreview.ourGroceriesList).toBeNull();
  expect((await request.put("/api/ourgroceries/default-list", {
    headers: productionHeaders,
    data: { listId: null }
  })).status()).toBe(200);
});
