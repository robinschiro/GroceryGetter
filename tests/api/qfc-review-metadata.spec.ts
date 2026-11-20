import { expect, test } from "playwright/test";
import { createDatabase } from "../../server/infrastructure/database/database.js";
import { createQfcService, FakeKrogerClient, type CartSubmissionMatch } from "../../server/infrastructure/kroger/krogerService.js";
import { createQfcRepository } from "../../server/features/qfc/qfcRepository.js";
import { createPlannerRepository } from "../../server/features/planner/plannerRepository.js";
import { createQfcWorkflowService } from "../../server/features/qfc/qfcWorkflowService.js";

test("cart transport rejects unverified units and sends confirmed quantities without conversion", async () => {
  const database = createDatabase({ filePath: ".cache/tests/unit-transport.sqlite" });
  await database.reset();
  try {
    database.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('krogerCustomerAccessToken', 'fake-token')");
    database.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('krogerCustomerTokenExpiresAt', '4102444800000')");
    const client = new FakeKrogerClient();
    const service = createQfcService(database, client);
    const item = { id: 1, text: "Produce", item: "Produce", quantity: "5", unit: "", sourceNames: "", approved: 1 };
    const match: CartSubmissionMatch = {
      item, cartQuantity: 5, selectionSource: "review", candidates: [],
      storeItem: { productId: "some-product", upc: "some-upc", description: "Produce", brand: "", size: "1 lb",
        soldBy: "WEIGHT", price: 2, regularPrice: 2, promotionalPrice: null, stockLevel: "HIGH",
        imageUrl: "", isStoreBrand: false, aisleLocations: [] }
    };
    await expect(service.addQfcMatchesToCart([item], [match], [])).rejects.toThrow(/ordering unit/);
    expect(client.cartSubmissions).toHaveLength(0);
    for (const unit of ["each", "oz", "kg", "lb"] as const) {
      match.quantityUnitVerification = { productId: "some-product", upc: "some-upc", unit };
      await service.addQfcMatchesToCart([item], [match], []);
      expect(client.cartSubmissions.at(-1)).toEqual([{ upc: "some-upc", quantity: 5, modality: "PICKUP" }]);
    }
  } finally {
    database.close();
  }
});

for (const scenario of ["success", "failure", "wrong UPC", "concurrent edit", "invalidated"] as const) {
  test(`saved review metadata refresh: ${scenario}`, async () => {
    const database = createDatabase({ filePath: `.cache/tests/metadata-${scenario}.sqlite` });
    await database.reset();
    try {
      database.run("INSERT INTO menus (id, name, meal_count) VALUES (1, 'Review', 1)");
      const repository = createQfcRepository(database);
      const revision = repository.beginReview(1, "production");
      const candidate = {
        productId: "arbitrary-product", upc: "arbitrary-upc", description: "Milk",
        brand: "", size: "52 fl oz", stockLevel: "HIGH", price: 4,
        regularPrice: 4, promotionalPrice: null, imageUrl: "", isStoreBrand: false,
        aisleLocations: []
      };
      const item = { id: 7, text: "milk", item: "milk", quantity: "1", unit: "", sourceNames: "", approved: 1 };
      repository.saveReview({
        id: "saved", kind: "preview", status: "complete", menuId: "1", dataScope: "production",
        reviewRevision: revision, createdAt: Date.now(),
        progress: { phase: "complete", processedItems: 1, totalItems: 1, message: "Saved" },
        result: { mode: "api", submittedItemCount: 0, message: "Saved", items: [item], skipped: [],
          matched: [{ item, storeItem: candidate, candidates: [candidate], selectionSource: "review", cartQuantity: 3 }] }
      });
      let calls = 0;
      const workflow = createQfcWorkflowService({
        plannerRepository: createPlannerRepository(database), qfcRepository: repository,
        qfcService: {
          ...createQfcService(database),
          async getStoreItem(productId, scope) {
            calls++;
            expect(productId).toBe(candidate.productId);
            expect(scope).toBe("production");
            if (scenario === "failure") throw new Error("Catalog offline");
            if (scenario === "concurrent edit") workflow.updateQuantity("saved", "production", 7, 9);
            if (scenario === "invalidated") repository.beginReview(1, "production");
            return { ...candidate, upc: scenario === "wrong UPC" ? "different" : candidate.upc, soldBy: "UNIT" };
          }
        }
      });
      // Simply reading a review performs no catalog requests.
      workflow.getMenuReview(1, "production");
      expect(calls).toBe(0);
      if (scenario === "invalidated") {
        await expect(workflow.refreshMenuReviewMetadata(1, "production")).rejects.toThrow(/unavailable|invalidated/);
        expect(repository.getReviewByMenuId(1, "production")).toBeNull();
      } else {
        const refreshed = await workflow.refreshMenuReviewMetadata(1, "production");
        const match = refreshed!.result.matched![0];
        expect(match.cartQuantity).toBe(scenario === "concurrent edit" ? 9 : 3);
        expect(match.storeItem.productId).toBe(candidate.productId);
        expect(match.selectionSource).toBe("review");
        expect(match.storeItem.soldBy).toBe(["failure", "wrong UPC"].includes(scenario) ? undefined : "UNIT");
        expect(repository.getReviewByMenuId(1, "production")!.result).toEqual(refreshed!.result);
      }
      // Selected item and duplicate dropdown entries share one lookup.
      expect(calls).toBe(1);
    } finally {
      database.close();
    }
  });
}
