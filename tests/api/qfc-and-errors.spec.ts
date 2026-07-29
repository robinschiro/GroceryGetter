import { expect, test, type APIRequestContext } from "playwright/test";
import {
  pollJob,
  productionHeaders,
  resetDatabase,
  sandboxHeaders
} from "../fixtures/characterization.js";

test.beforeEach(async ({ request }) => {
  await resetDatabase(request);
});

async function aggregatedMenu(request: APIRequestContext) {
  const preview = await (await request.post("/api/menus/preview", {
    headers: productionHeaders,
    data: { mealCount: 1 }
  })).json();
  const saved = await request.post("/api/menus", {
    headers: productionHeaders,
    data: {
      name: "QFC Characterization",
      mealCount: 1,
      items: preview.items,
      customShoppingListIds: preview.customShoppingListIds
    }
  });
  const menuId = (await saved.json()).id as number;
  expect((await request.post(`/api/menus/${menuId}/aggregate`, {
    headers: productionHeaders
  })).status()).toBe(201);
  return menuId;
}

test("settings and fake Kroger searches preserve scope restrictions and deterministic failures", async ({ request }) => {
  const productionSettings = await (await request.get("/api/settings", {
    headers: productionHeaders
  })).json();
  const sandboxSettings = await (await request.get("/api/settings", { headers: sandboxHeaders })).json();
  expect(productionSettings.allowRealQfcCartMutation).toBe("true");
  expect(sandboxSettings.allowRealQfcCartMutation).toBe("false");

  expect((await request.put("/api/settings/preferStoreBrands", {
    headers: sandboxHeaders,
    data: { value: "true" }
  })).status()).toBe(200);
  expect((await request.put("/api/settings/notAllowed", {
    headers: productionHeaders,
    data: { value: "x" }
  })).status()).toBe(400);
  expect((await request.put("/api/qfc/settings", {
    headers: sandboxHeaders,
    data: { clientId: "forbidden" }
  })).status()).toBe(403);
  expect((await request.post("/api/qfc/oauth/start", { headers: sandboxHeaders })).status()).toBe(403);
  expect((await request.post("/api/qfc/oauth/refresh", { headers: sandboxHeaders })).status()).toBe(403);

  const locations = await request.get("/api/qfc/locations?query=98101", { headers: productionHeaders });
  expect(locations.status()).toBe(200);
  expect(await locations.json()).toMatchObject([{ locationId: "fake-qfc-001", chain: "QFC" }]);
  expect((await request.get("/api/qfc/locations?query=fail", {
    headers: productionHeaders
  })).status()).toBe(400);
  expect((await request.get("/api/qfc/locations", { headers: productionHeaders })).status()).toBe(400);

  const products = await request.get("/api/qfc/store-items?term=tomato", {
    headers: productionHeaders
  });
  expect(products.status()).toBe(200);
  const candidates = await products.json();
  expect(candidates).toHaveLength(2);
  expect(candidates[0]).toMatchObject({ brand: "Kroger", isStoreBrand: true });
  expect((await request.get("/api/qfc/store-items?term=fail", {
    headers: productionHeaders
  })).status()).toBe(400);
});

test("QFC review preserves matching, unmatched items, selection memory, quantity, search, remove/restore, polling, fake submit, and failures", async ({ request }) => {
  const menuId = await aggregatedMenu(request);
  const previewResponse = await request.post(`/api/menus/${menuId}/preview-qfc`, {
    headers: productionHeaders
  });
  expect(previewResponse.status()).toBe(202);
  const previewJob = await pollJob(request, (await previewResponse.json()).jobId);
  expect(previewJob.result.matched.length).toBeGreaterThan(0);

  const match = previewJob.result.matched[0];
  const alternate = match.candidates[1];
  const selection = await request.put(
    `/api/store-item-reviews/${previewJob.id}/selections/${match.item.id}`,
    {
      headers: productionHeaders,
      data: { productId: alternate.productId, upc: alternate.upc }
    }
  );
  expect(selection.status()).toBe(200);
  expect((await selection.json()).match).toMatchObject({
    selectionSource: "remembered",
    storeItem: { productId: alternate.productId }
  });
  expect((await (await request.get("/api/store-item-preferences", {
    headers: productionHeaders
  })).json()).length).toBe(1);

  const quantity = await request.put(
    `/api/store-item-reviews/${previewJob.id}/quantities/${match.item.id}`,
    { headers: productionHeaders, data: { cartQuantity: 3 } }
  );
  expect(quantity.status()).toBe(200);
  expect((await quantity.json()).match.cartQuantity).toBe(3);
  expect((await request.put(`/api/store-item-reviews/${previewJob.id}/quantities/${match.item.id}`, {
    headers: productionHeaders,
    data: { cartQuantity: 0 }
  })).status()).toBe(400);

  const search = await request.post(
    `/api/store-item-reviews/${previewJob.id}/items/${match.item.id}/search`,
    { headers: productionHeaders, data: { term: "custom tomato" } }
  );
  expect(search.status()).toBe(200);
  expect((await search.json()).match.selectionSource).toBe("search");

  const removed = await request.delete(
    `/api/store-item-reviews/${previewJob.id}/items/${match.item.id}`,
    { headers: productionHeaders }
  );
  expect(removed.status()).toBe(200);
  expect((await removed.json()).removedItem.id).toBe(match.item.id);
  const restored = await request.post(
    `/api/store-item-reviews/${previewJob.id}/items/${match.item.id}/search`,
    { headers: productionHeaders, data: { term: "restored tomato" } }
  );
  expect(restored.status()).toBe(200);
  expect((await restored.json()).items.some((item: { id: number }) => item.id === match.item.id)).toBeTruthy();

  const blocked = await request.post(`/api/qfc/submit-jobs/${previewJob.id}/add-to-cart`, {
    headers: sandboxHeaders
  });
  expect([403, 409]).toContain(blocked.status());
  const submitResponse = await request.post(`/api/qfc/submit-jobs/${previewJob.id}/add-to-cart`, {
    headers: productionHeaders
  });
  expect(submitResponse.status()).toBe(202);
  const submitJob = await pollJob(request, (await submitResponse.json()).jobId);
  expect(submitJob.result.mode).toBe("api");
  expect(submitJob.result.submittedItemCount).toBeGreaterThan(0);

  expect((await request.get("/api/qfc/submit-jobs/missing", {
    headers: productionHeaders
  })).status()).toBe(404);
  expect((await request.post(`/api/store-item-reviews/${previewJob.id}/items/${match.item.id}/search`, {
    headers: productionHeaders,
    data: { term: "fail" }
  })).status()).toBe(400);
});
