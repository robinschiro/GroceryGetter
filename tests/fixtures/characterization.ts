import { expect, type APIRequestContext } from "playwright/test";

const entreeRecipes = Array.from({ length: 51 }, (_, index) => ({
  name: index === 0 ? "Weeknight Pasta" : `Entree ${String(index + 1).padStart(2, "0")}`,
  category: "entree" as const,
  includeInMenuGeneration: true,
  servings: 4,
  notes: index === 0 ? "Characterization fixture" : "",
  ingredients: index === 0
    ? [
        { text: "1 tomato", quantity: "1", item: "tomato" },
        { text: "1 lb pasta", quantity: "1", unit: "lb", item: "pasta" },
        { text: "1 tbsp olive oil", quantity: "1", unit: "tbsp", item: "olive oil" }
      ]
    : [{ text: `${index + 1} entree item`, quantity: String(index + 1), item: `entree item ${index + 1}` }]
}));

export const characterizationSeed = {
  recipes: [
    ...entreeRecipes,
    {
      name: "Roasted Broccoli",
      category: "vegetable_side" as const,
      includeInMenuGeneration: true,
      ingredients: [
        { text: "2 tomatoes", quantity: "2", item: "tomato" },
        { text: "1 broccoli crown", quantity: "1", item: "broccoli" }
      ]
    },
    {
      name: "Garlic Rice",
      category: "starch_side" as const,
      includeInMenuGeneration: true,
      ingredients: [{ text: "2 cups rice", quantity: "2", unit: "cups", item: "rice" }]
    },
    {
      name: "Sandbox Tacos",
      category: "entree" as const,
      dataScope: "sandbox" as const,
      includeInMenuGeneration: true,
      ingredients: [{ text: "4 unmatched shells", quantity: "4", item: "unmatched shells" }]
    }
  ],
  customShoppingLists: [
    {
      name: "Weekly Staples",
      includeInMenuByDefault: true,
      items: [
        { text: "1 tomato", quantity: "1", item: "tomato" },
        { text: "1 gallon milk", quantity: "1", unit: "gallon", item: "milk" },
        {
          text: "1 preferred unavailable item",
          quantity: "1",
          item: "preferred unavailable item"
        },
        { text: "1 unmatched item", quantity: "1", item: "unmatched item" }
      ]
    },
    {
      name: "Sandbox Supplies",
      dataScope: "sandbox" as const,
      items: [{ text: "1 unmatched item", quantity: "1", item: "unmatched item" }]
    }
  ],
  settings: {
    krogerClientId: "fake-client-id",
    krogerClientSecret: "fake-client-secret",
    krogerCustomerAccessToken: "fake-customer-token",
    krogerCustomerRefreshToken: "fake-refresh-token",
    krogerCustomerTokenExpiresAt: "4102444800000"
  },
  scopedSettings: [
    { dataScope: "production" as const, key: "krogerLocationId", value: "fake-qfc-001" },
    { dataScope: "production" as const, key: "preferStoreBrands", value: "true" },
    { dataScope: "production" as const, key: "allowRealQfcCartMutation", value: "true" },
    { dataScope: "sandbox" as const, key: "preferStoreBrands", value: "false" },
    { dataScope: "sandbox" as const, key: "allowRealQfcCartMutation", value: "false" }
  ]
};

export async function resetDatabase(
  request: APIRequestContext,
  seed: typeof characterizationSeed | Record<string, unknown> = characterizationSeed
) {
  const response = await request.post("/api/test/reset", { data: { seed } });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ reset: true });
}

export const productionHeaders = { "X-Data-Scope": "production" };
export const sandboxHeaders = { "X-Data-Scope": "sandbox" };

export async function pollJob(request: APIRequestContext, jobId: string, headers = productionHeaders) {
  await expect.poll(async () => {
    const response = await request.get(`/api/qfc/submit-jobs/${jobId}`, { headers });
    if (!response.ok()) return `http-${response.status()}`;
    return (await response.json()).status;
  }).toBe("complete");

  const response = await request.get(`/api/qfc/submit-jobs/${jobId}`, { headers });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
