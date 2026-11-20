import type { GroceryDatabase } from "../../infrastructure/database/database.js";
import type { DataScope } from "../../types.js";
import type { CartOrderingUnit, QuantityUnitVerification, StoreItemMatch } from "../../../shared/contracts/index.js";
import { normalizeCartOrderingUnit } from "../../../shared/storeItemUnits.js";

export function createStoreItemMetadataRepository(database: GroceryDatabase) {
  function get(dataScope: DataScope, provider: string, productId: string) {
    const row = database.queryOne<{ unit: string; verifiedAt: string }>(
      `SELECT ordering_unit AS unit, verified_at AS verifiedAt FROM store_item_metadata
       WHERE data_scope = ? AND provider = ? AND product_id = ?`,
      [dataScope, provider, productId]
    );
    const unit = normalizeCartOrderingUnit(row?.unit);
    return row && unit ? { ...row, unit } : null;
  }

  function save(dataScope: DataScope, provider: string, productId: string, unit: CartOrderingUnit) {
    database.run(
      `INSERT INTO store_item_metadata (data_scope, provider, product_id, ordering_unit, verified_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(data_scope, provider, product_id) DO UPDATE SET
         ordering_unit = excluded.ordering_unit, verified_at = excluded.verified_at`,
      [dataScope, provider, productId, normalizeCartOrderingUnit(unit), new Date().toISOString()]
    );
  }

  function apply(dataScope: DataScope, match: Pick<StoreItemMatch, "storeItem" | "quantityUnitVerification">) {
    const metadata = get(dataScope, "kroger", match.storeItem.productId);
    if (metadata) {
      match.quantityUnitVerification = {
        productId: match.storeItem.productId,
        upc: match.storeItem.upc,
        ...metadata
      } satisfies QuantityUnitVerification;
    }
  }

  return { get, save, apply };
}
