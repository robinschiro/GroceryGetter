import { expect, test, type APIRequestContext } from "playwright/test";
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
      customShoppingListIds: preview.customShoppingListIds
    }
  });
  expect(savedResponse.status()).toBe(201);
  return { id: (await savedResponse.json()).id as number, preview };
}

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
