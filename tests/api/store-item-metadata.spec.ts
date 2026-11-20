import { expect, test } from "playwright/test";
import { createDatabase, type GroceryDatabase } from "../../server/infrastructure/database/database.js";
import { createQfcRepository } from "../../server/features/qfc/qfcRepository.js";
import { createStoreItemMetadataRepository } from "../../server/features/qfc/storeItemMetadataRepository.js";
import { createQfcWorkflowService } from "../../server/features/qfc/qfcWorkflowService.js";
import { createPlannerRepository } from "../../server/features/planner/plannerRepository.js";
import { createQfcService } from "../../server/infrastructure/kroger/krogerService.js";
import type { DataScope } from "../../server/types.js";
import type { CartOrderingUnit } from "../../shared/contracts/index.js";

function seedReview(database: GroceryDatabase, menuId: number, scope: DataScope = "production", unit?: CartOrderingUnit, upc = "barcode") {
  database.run("INSERT INTO menus (id, name, meal_count, data_scope) VALUES (?, 'Menu', 1, ?)", [menuId, scope]);
  const repository = createQfcRepository(database);
  const revision = repository.beginReview(menuId, scope);
  const candidate = {
    productId: "product", upc, description: "Produce", brand: "", size: "1 lb", soldBy: "WEIGHT",
    stockLevel: "HIGH", price: 2, regularPrice: 2, promotionalPrice: null, imageUrl: "",
    isStoreBrand: false, aisleLocations: []
  };
  const item = { id: menuId, text: `Ingredient ${menuId}`, item: `Ingredient ${menuId}`, quantity: "5", unit: "", sourceNames: "", approved: 1 };
  const job = {
    id: `job-${menuId}`, kind: "preview", status: "complete", menuId: String(menuId), dataScope: scope,
    reviewRevision: revision, createdAt: Date.now(),
    progress: { phase: "complete", processedItems: 1, totalItems: 1, message: "Saved" },
    result: { mode: "api", submittedItemCount: 0, message: "Saved", items: [item], skipped: [],
      matched: [{ item, storeItem: candidate, candidates: [candidate, { ...candidate, productId: "different-product" }],
        selectionSource: "review", cartQuantity: 5,
        ...(unit ? { quantityUnitVerification: { productId: candidate.productId, upc, unit } } : {}) }] }
  } satisfies Parameters<typeof repository.saveReview>[0];
  repository.saveReview(job);
  return job;
}

test("product units persist across menus, ingredients, UPCs, selections, corrections and restarts with scope isolation", async () => {
  const database = createDatabase({ filePath: ".cache/tests/product-unit-reuse.sqlite" });
  await database.reset();
  try {
    seedReview(database, 1);
    const repository = createQfcRepository(database);
    const workflow = createQfcWorkflowService({ plannerRepository: createPlannerRepository(database),
      qfcRepository: repository, qfcService: createQfcService(database) });
    workflow.verifyQuantityUnit("job-1", "production", 1, "product", "barcode", "each", true);
    expect(createStoreItemMetadataRepository(database).get("production", "kroger", "product")?.unit).toBe("each");
    expect(createStoreItemMetadataRepository(database).get("production", "other-provider", "product")).toBeNull();
    seedReview(database, 2, "production", undefined, "different-barcode");
    seedReview(database, 3, "sandbox");
    const restored = workflow.getMenuReview(2, "production")!.result.matched![0];
    expect(restored.quantityUnitVerification).toMatchObject({ productId: "product", upc: "different-barcode", unit: "each" });
    expect(restored.quantityUnitVerification?.verifiedAt).toBeTruthy();
    expect(workflow.getMenuReview(3, "sandbox")!.result.matched![0].quantityUnitVerification).toBeUndefined();
    expect(workflow.selectStoreItem("job-2", "production", 2, "different-product", "different-barcode", false)
      .match.quantityUnitVerification).toBeUndefined();
    expect(workflow.selectStoreItem("job-2", "production", 2, "product", "different-barcode", false)
      .match.quantityUnitVerification?.unit).toBe("each");
    workflow.verifyQuantityUnit("job-2", "production", 2, "product", "different-barcode", "oz", true);
    expect(workflow.getMenuReview(1, "production")!.result.matched![0].quantityUnitVerification?.unit).toBe("oz");
    expect(workflow.getMenuReview(1, "production")!.result.matched![0].cartQuantity).toBe(5);
    database.close();
    await database.initialize();
    const reopened = createQfcRepository(database).getReviewByMenuId(1, "production")!;
    expect(reopened.result.matched![0].quantityUnitVerification?.unit).toBe("oz");
    expect(reopened.result.matched![0].cartQuantity).toBe(5);
  } finally { database.close(); }
});

test("one-time migration carries forward valid verifications with newest-review precedence and preserves review JSON", async () => {
  const database = createDatabase({ filePath: ".cache/tests/product-unit-migration.sqlite" });
  await database.reset();
  try {
    seedReview(database, 1, "production", "each");
    seedReview(database, 2, "production", "lb");
    seedReview(database, 3, "sandbox", "oz");
    const invalid = seedReview(database, 4, "production", "kg");
    invalid.result.matched[0].quantityUnitVerification!.productId = "stale-product";
    createQfcRepository(database).saveReview(invalid);
    database.run("UPDATE store_item_reviews SET updated_at = '2026-01-01' WHERE menu_id = 1");
    database.run("UPDATE store_item_reviews SET updated_at = '2026-02-01' WHERE menu_id = 2");
    const before = database.queryAll("SELECT menu_id, result_json FROM store_item_reviews ORDER BY menu_id");
    // Recreate the pre-migration schema in this disposable database.
    database.exec("DROP TABLE store_item_metadata");
    database.save(); database.close();
    await database.initialize();
    const metadata = createStoreItemMetadataRepository(database);
    expect(metadata.get("production", "kroger", "product")?.unit).toBe("lb");
    expect(metadata.get("sandbox", "kroger", "product")?.unit).toBe("oz");
    expect(metadata.get("production", "kroger", "stale-product")).toBeNull();
    expect(database.queryAll("SELECT menu_id, result_json FROM store_item_reviews ORDER BY menu_id")).toEqual(before);
    metadata.save("production", "kroger", "product", "each"); database.save(); database.close();
    await database.initialize();
    expect(createStoreItemMetadataRepository(database).get("production", "kroger", "product")?.unit).toBe("each");
  } finally { database.close(); }
});

test("legacy package and bunch units migrate to count without changing timestamps, quantities or weight units", async () => {
  const database = createDatabase({ filePath: ".cache/tests/legacy-count-units.sqlite" });
  await database.reset();
  try {
    const job = seedReview(database, 1);
    const legacyResult = { ...job.result, matched: job.result.matched.map((match) => ({
      ...match, quantityUnitVerification: { productId: "product", upc: "barcode", unit: "package" }
    })) };
    database.run("UPDATE store_item_reviews SET result_json = ?", [JSON.stringify(legacyResult)]);
    database.exec(`DROP TABLE store_item_metadata;
      CREATE TABLE store_item_metadata (
        data_scope TEXT, provider TEXT, product_id TEXT, ordering_unit TEXT, verified_at TEXT,
        PRIMARY KEY (data_scope, provider, product_id));
      INSERT INTO store_item_metadata VALUES ('production', 'kroger', 'product', 'package', 'original-time');
      INSERT INTO store_item_metadata VALUES ('production', 'kroger', 'bunched-product', 'bunch', 'original-time');
      INSERT INTO store_item_metadata VALUES ('production', 'kroger', 'weighted-product', 'lb', 'original-time');`);
    database.save(); database.close();
    await database.initialize();
    const metadata = createStoreItemMetadataRepository(database);
    expect(metadata.get("production", "kroger", "product")).toEqual({ unit: "each", verifiedAt: "original-time" });
    expect(metadata.get("production", "kroger", "bunched-product")?.unit).toBe("each");
    expect(metadata.get("production", "kroger", "weighted-product")?.unit).toBe("lb");
    expect(database.queryOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM store_item_metadata WHERE ordering_unit IN ('package', 'bunch')"
    )!.count).toBe(0);
    const match = createQfcRepository(database).getReviewByMenuId(1, "production")!.result.matched![0];
    expect(match.cartQuantity).toBe(5);
    expect(match.quantityUnitVerification?.unit).toBe("each");
    // Also cover importing a legacy review when the metadata table does not exist yet.
    database.exec("DROP TABLE store_item_metadata"); database.save(); database.close();
    await database.initialize();
    expect(createStoreItemMetadataRepository(database).get("production", "kroger", "product")?.unit).toBe("each");
  } finally { database.close(); }
});
