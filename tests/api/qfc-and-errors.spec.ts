import { expect, test, type APIRequestContext } from "playwright/test";
import { cartOrderingUnit, storeItemUnits } from "../../shared/storeItemUnits.js";
import {
  pollJob,
  productionHeaders,
  resetDatabase,
  sandboxHeaders
} from "../fixtures/characterization.js";

test.beforeEach(async ({ request }) => {
  await resetDatabase(request);
});

test("ordering units stay separate from pricing weight, including saved reviews without sales metadata", () => {
  expect(storeItemUnits({ size: "1 lb", soldBy: "WEIGHT" }))
    .toEqual({ priceUnit: "lb", sizeLabel: "Pricing size: 1 lb" });
  expect(storeItemUnits({ size: "12 oz", soldBy: "UNIT" }))
    .toEqual({ priceUnit: null, sizeLabel: "Package size: 12 oz" });
  expect(storeItemUnits({ size: "1 lb" }))
    .toEqual({ priceUnit: null, sizeLabel: "Catalog size: 1 lb" });
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

async function verifyFakeReviewUnits(request: APIRequestContext, jobId: string) {
  const review = await (await request.get(`/api/qfc/submit-jobs/${jobId}`, { headers: productionHeaders })).json();
  for (const match of review.result.matched) {
    if (cartOrderingUnit(match)) continue;
    expect((await request.put(`/api/store-item-reviews/${jobId}/quantity-units/${match.item.id}`, {
      headers: productionHeaders,
      data: { productId: match.storeItem.productId, upc: match.storeItem.upc, unit: "lb", verifiedOnQfc: true }
    })).status()).toBe(200);
  }
}

test("ambiguous quantities are blocked until verified for the exact selected product", async ({ request }) => {
  const menuId = await aggregatedMenu(request);
  const preview = await request.post(`/api/menus/${menuId}/preview-qfc`, { headers: productionHeaders });
  const review = await pollJob(request, (await preview.json()).jobId);
  const match = review.result.matched.find((candidate: { storeItem: { soldBy: string } }) => candidate.storeItem.soldBy === "WEIGHT");
  expect(match).toBeTruthy();
  const submit = () => request.post(`/api/qfc/submit-jobs/${review.id}/add-to-cart`, { headers: productionHeaders });
  expect((await submit()).status()).toBe(409);
  const endpoint = `/api/store-item-reviews/${review.id}/quantity-units/${match.item.id}`;
  const data = { productId: match.storeItem.productId, upc: match.storeItem.upc, unit: "each", verifiedOnQfc: true };
  expect((await request.put(endpoint, { headers: productionHeaders, data: { ...data, verifiedOnQfc: false } })).status()).toBe(400);
  expect((await request.put(endpoint, { headers: productionHeaders, data: { ...data, productId: "stale-selection" } })).status()).toBe(409);
  expect((await request.put(endpoint, { headers: productionHeaders, data: { ...data, unit: "guess" } })).status()).toBe(400);
  expect((await request.put(endpoint, { headers: sandboxHeaders, data })).status()).toBe(409);
  const verified = await request.put(endpoint, { headers: productionHeaders, data });
  expect(verified.status()).toBe(200);
  expect((await verified.json()).match.cartQuantity).toBe(match.cartQuantity);
  let saved = await (await request.get(`/api/menus/${menuId}/store-item-review`, { headers: productionHeaders })).json();
  expect(saved.result.matched.find((m: { item: { id: number } }) => m.item.id === match.item.id).quantityUnitVerification).toMatchObject({
    productId: data.productId, upc: data.upc, unit: "each"
  });
  await verifyFakeReviewUnits(request, review.id);
  // Searching and reselecting the verified product reuses its saved unit.
  await request.post(`/api/store-item-reviews/${review.id}/items/${match.item.id}/search`, {
    headers: productionHeaders, data: { term: "preferred unavailable item" }
  });
  await request.put(`/api/store-item-reviews/${review.id}/selections/${match.item.id}`, {
    headers: productionHeaders, data: { productId: data.productId, upc: data.upc }
  });
  saved = await (await request.get(`/api/menus/${menuId}/store-item-review`, { headers: productionHeaders })).json();
  expect(saved.result.matched.find((m: { item: { id: number } }) => m.item.id === match.item.id).quantityUnitVerification.unit).toBe("each");
  const futureMenuId = await aggregatedMenu(request);
  const future = await request.post(`/api/menus/${futureMenuId}/preview-qfc`, { headers: productionHeaders });
  const futureReview = await pollJob(request, (await future.json()).jobId);
  expect(futureReview.result.matched.find((m: { storeItem: { productId: string } }) =>
    m.storeItem.productId === data.productId).quantityUnitVerification.unit).toBe("each");
  // Choose an ambiguous alternate and ensure the API blocks it too.
  const alternate = match.candidates[2];
  await request.put(`/api/store-item-reviews/${review.id}/selections/${match.item.id}`, {
    headers: productionHeaders, data: { productId: alternate.productId, upc: alternate.upc }
  });
  expect((await submit()).status()).toBe(409);
  await verifyFakeReviewUnits(request, review.id);
  expect((await submit()).status()).toBe(202);
});

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
  expect(candidates).toHaveLength(3);
  expect(cartOrderingUnit({ storeItem: candidates[0] })).toBe("each");
  expect(cartOrderingUnit({ storeItem: { ...candidates[0], size: "1 ct" } })).toBe("each");
  expect(cartOrderingUnit({ storeItem: { ...candidates[0], size: "8 ct / 30 oz" } })).toBe("each");
  const weighted = { ...candidates[1], averageWeightPerUnit: "0.24 [lb_av]" };
  expect(cartOrderingUnit({ storeItem: weighted })).toBeNull();
  expect(cartOrderingUnit({ storeItem: candidates[2] })).toBeNull();
  expect(cartOrderingUnit({ storeItem: weighted, quantityUnitVerification: {
    productId: "other-product", upc: weighted.upc, unit: "each"
  } })).toBeNull();
  expect(candidates[0]).toMatchObject({
    aisleLocations: [{ number: "10", description: "Produce" }],
    brand: "Kroger",
    soldBy: "UNIT",
    isStoreBrand: true,
    price: 2.49,
    regularPrice: 2.49,
    promotionalPrice: null,
    stockLevel: "HIGH"
  });
  expect(candidates[1]).toMatchObject({
    aisleLocations: [{ number: "5", description: "Pantry" }],
    soldBy: "WEIGHT",
    price: 3.49,
    regularPrice: 3.99,
    promotionalPrice: 3.49,
    stockLevel: "LOW"
  });
  expect(candidates[2]).toMatchObject({
    aisleLocations: [],
    price: null,
    regularPrice: null,
    promotionalPrice: null,
    stockLevel: "TEMPORARILY_OUT_OF_STOCK"
  });
  expect((await request.get("/api/qfc/store-items?term=fail", {
    headers: productionHeaders
  })).status()).toBe(400);
});

test("QFC review refreshes an exact remembered product outside the ingredient search results", async ({ request }) => {
  const menuId = await aggregatedMenu(request);
  const firstPreviewResponse = await request.post(`/api/menus/${menuId}/preview-qfc`, {
    headers: productionHeaders
  });
  const firstPreview = await pollJob(request, (await firstPreviewResponse.json()).jobId);
  const match = firstPreview.result.matched.find(
    (candidate: { item: { item: string } }) => candidate.item.item === "tomato"
  );
  expect(match).toBeTruthy();

  const customSearch = await request.post(
    `/api/store-item-reviews/${firstPreview.id}/items/${match.item.id}/search`,
    { headers: productionHeaders, data: { term: "custom tomato" } }
  );
  expect(customSearch.status()).toBe(200);
  const customCandidate = (await customSearch.json()).match.candidates[0];
  expect((await request.put(
    `/api/store-item-reviews/${firstPreview.id}/selections/${match.item.id}`,
    {
      headers: productionHeaders,
      data: {
        productId: customCandidate.productId,
        upc: customCandidate.upc,
        rememberPreference: true
      }
    }
  )).status()).toBe(200);

  const secondPreviewResponse = await request.post(`/api/menus/${menuId}/preview-qfc`, {
    headers: productionHeaders
  });
  const secondPreview = await pollJob(request, (await secondPreviewResponse.json()).jobId);
  const refreshedMatch = secondPreview.result.matched.find(
    (candidate: { item: { id: number } }) => candidate.item.id === match.item.id
  );
  expect(refreshedMatch).toMatchObject({
    selectionSource: "remembered",
    storeItem: {
      productId: customCandidate.productId,
      upc: customCandidate.upc,
      aisleLocations: [{ number: "10", description: "Produce" }]
    }
  });
  expect(refreshedMatch.candidates).toContainEqual(expect.objectContaining({
    productId: customCandidate.productId,
    upc: customCandidate.upc
  }));

  const preferences = await (await request.get("/api/store-item-preferences", {
    headers: productionHeaders
  })).json();
  expect(preferences).toContainEqual(expect.objectContaining({
    ingredientKey: "tomato",
    storeItemId: customCandidate.productId,
    upc: customCandidate.upc
  }));
});

test("QFC review retains remembered product when exact metadata refresh returns no product", async ({ request }) => {
  const menuId = await aggregatedMenu(request);
  const firstPreviewResponse = await request.post(`/api/menus/${menuId}/preview-qfc`, {
    headers: productionHeaders
  });
  const firstPreview = await pollJob(request, (await firstPreviewResponse.json()).jobId);
  const match = firstPreview.result.matched.find(
    (candidate: { item: { item: string } }) => candidate.item.item === "tomato"
  );

  const customSearch = await request.post(
    `/api/store-item-reviews/${firstPreview.id}/items/${match.item.id}/search`,
    { headers: productionHeaders, data: { term: "missing remembered tomato" } }
  );
  const customCandidate = (await customSearch.json()).match.candidates[0];
  expect((await request.put(
    `/api/store-item-reviews/${firstPreview.id}/selections/${match.item.id}`,
    {
      headers: productionHeaders,
      data: {
        productId: customCandidate.productId,
        upc: customCandidate.upc,
        rememberPreference: true
      }
    }
  )).status()).toBe(200);

  const secondPreviewResponse = await request.post(`/api/menus/${menuId}/preview-qfc`, {
    headers: productionHeaders
  });
  const secondPreview = await pollJob(request, (await secondPreviewResponse.json()).jobId);
  const refreshedMatch = secondPreview.result.matched.find(
    (candidate: { item: { id: number } }) => candidate.item.id === match.item.id
  );
  expect(refreshedMatch).toMatchObject({
    selectionSource: "remembered",
    storeItem: {
      productId: customCandidate.productId,
      upc: customCandidate.upc,
      aisleLocations: []
    }
  });
  expect(refreshedMatch.candidates[0]).toMatchObject({
    productId: customCandidate.productId,
    upc: customCandidate.upc
  });
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
      data: {
        productId: alternate.productId,
        upc: alternate.upc,
        rememberPreference: true
      }
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

  const reviewOnlyCandidate = match.candidates[0];
  const reviewOnlySelection = await request.put(
    `/api/store-item-reviews/${previewJob.id}/selections/${match.item.id}`,
    {
      headers: productionHeaders,
      data: {
        productId: reviewOnlyCandidate.productId,
        upc: reviewOnlyCandidate.upc,
        rememberPreference: false
      }
    }
  );
  expect(reviewOnlySelection.status()).toBe(200);
  expect(await reviewOnlySelection.json()).toMatchObject({
    preference: null,
    match: {
      selectionSource: "review",
      storeItem: { productId: reviewOnlyCandidate.productId }
    }
  });
  expect((await (await request.get("/api/store-item-preferences", {
    headers: productionHeaders
  })).json())[0]).toMatchObject({
    storeItemId: alternate.productId,
    upc: alternate.upc
  });

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
  await verifyFakeReviewUnits(request, previewJob.id);
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

test("QFC review uses an available search result without replacing an unavailable preference", async ({ request }) => {
  const menuId = await aggregatedMenu(request);
  const firstPreviewResponse = await request.post(`/api/menus/${menuId}/preview-qfc`, {
    headers: productionHeaders
  });
  const firstPreview = await pollJob(request, (await firstPreviewResponse.json()).jobId);
  const firstMatch = firstPreview.result.matched.find(
    (match: { item: { item: string } }) => match.item.item === "preferred unavailable item"
  );
  expect(firstMatch).toBeTruthy();
  const unavailableCandidate = firstMatch.candidates.find(
    (candidate: { stockLevel: string }) => candidate.stockLevel === "TEMPORARILY_OUT_OF_STOCK"
  );
  expect(unavailableCandidate).toBeTruthy();

  const remembered = await request.put(
    `/api/store-item-reviews/${firstPreview.id}/selections/${firstMatch.item.id}`,
    {
      headers: productionHeaders,
      data: {
        productId: unavailableCandidate.productId,
        upc: unavailableCandidate.upc,
        rememberPreference: true
      }
    }
  );
  expect(remembered.status()).toBe(200);

  const secondPreviewResponse = await request.post(`/api/menus/${menuId}/preview-qfc`, {
    headers: productionHeaders
  });
  const secondPreview = await pollJob(request, (await secondPreviewResponse.json()).jobId);
  const fallbackMatch = secondPreview.result.matched.find(
    (match: { item: { id: number } }) => match.item.id === firstMatch.item.id
  );
  expect(fallbackMatch).toMatchObject({
    selectionSource: "preferred-unavailable",
    storeItem: { stockLevel: "LOW" }
  });
  expect(fallbackMatch.storeItem.productId).not.toBe(unavailableCandidate.productId);

  const preferences = await (await request.get("/api/store-item-preferences", {
    headers: productionHeaders
  })).json();
  expect(preferences).toHaveLength(1);
  expect(preferences[0]).toMatchObject({
    storeItemId: unavailableCandidate.productId,
    upc: unavailableCandidate.upc
  });
});

test("QFC review restores saved edits by menu and is invalidated by aggregation changes", async ({ request }) => {
  const menuId = await aggregatedMenu(request);
  const previewResponse = await request.post(`/api/menus/${menuId}/preview-qfc`, {
    headers: productionHeaders
  });
  const preview = await pollJob(request, (await previewResponse.json()).jobId);
  const firstMatch = preview.result.matched[0];
  const removedItem = preview.result.items.find(
    (item: { id: number }) => item.id !== firstMatch.item.id
  );
  expect(removedItem).toBeTruthy();

  expect((await request.put(
    `/api/store-item-reviews/${preview.id}/quantities/${firstMatch.item.id}`,
    { headers: productionHeaders, data: { cartQuantity: 4 } }
  )).status()).toBe(200);
  expect((await request.delete(
    `/api/store-item-reviews/${preview.id}/items/${removedItem.id}`,
    { headers: productionHeaders }
  )).status()).toBe(200);

  const restoredResponse = await request.get(`/api/menus/${menuId}/store-item-review`, {
    headers: productionHeaders
  });
  expect(restoredResponse.status()).toBe(200);
  const restored = await restoredResponse.json();
  expect(restored).toMatchObject({ id: preview.id, status: "complete" });
  expect(restored.result.matched.find(
    (match: { item: { id: number } }) => match.item.id === firstMatch.item.id
  ).cartQuantity).toBe(4);
  expect(restored.result.items.some(
    (item: { id: number }) => item.id === removedItem.id
  )).toBeFalsy();

  expect((await request.post(`/api/menus/${menuId}/aggregate`, {
    headers: productionHeaders
  })).status()).toBe(201);
  expect(await (await request.get(`/api/menus/${menuId}/store-item-review`, {
    headers: productionHeaders
  })).json()).toBeNull();
  expect((await request.put(
    `/api/store-item-reviews/${preview.id}/quantities/${firstMatch.item.id}`,
    { headers: productionHeaders, data: { cartQuantity: 2 } }
  )).status()).toBe(409);
});

test("new previews supersede cached jobs and menu edits invalidate saved reviews", async ({ request }) => {
  const menuId = await aggregatedMenu(request);
  const firstResponse = await request.post(`/api/menus/${menuId}/preview-qfc`, {
    headers: productionHeaders
  });
  const first = await pollJob(request, (await firstResponse.json()).jobId);

  const secondResponse = await request.post(`/api/menus/${menuId}/preview-qfc`, {
    headers: productionHeaders
  });
  expect(secondResponse.status()).toBe(202);
  expect((await request.get(`/api/qfc/submit-jobs/${first.id}`, {
    headers: productionHeaders
  })).status()).toBe(409);
  const second = await pollJob(request, (await secondResponse.json()).jobId);
  expect(await (await request.get(`/api/menus/${menuId}/store-item-review`, {
    headers: productionHeaders
  })).json()).toMatchObject({ id: second.id });

  const menu = await (await request.get(`/api/menus/${menuId}`, {
    headers: productionHeaders
  })).json();
  const menuItem = menu.items[0];
  expect((await request.put(`/api/menu-items/${menuItem.id}`, {
    headers: productionHeaders,
    data: { recipeId: menuItem.recipeId }
  })).status()).toBe(200);
  expect(await (await request.get(`/api/menus/${menuId}/store-item-review`, {
    headers: productionHeaders
  })).json()).toBeNull();
  expect(await (await request.get(`/api/menus/${menuId}/shopping-list`, {
    headers: productionHeaders
  })).json()).toEqual([]);
  expect((await request.post(`/api/qfc/submit-jobs/${second.id}/add-to-cart`, {
    headers: productionHeaders
  })).status()).toBe(409);
});
