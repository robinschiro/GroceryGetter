import type { CartOrderingUnit, StoreItemCandidate, StoreItemMatch } from "./contracts/index.js";

export const cartOrderingUnits: CartOrderingUnit[] = ["each", "lb", "oz", "kg", "g"];

export function normalizeCartOrderingUnit(unit: unknown): CartOrderingUnit | null {
  if (unit === "bunch" || unit === "package") return "each";
  return cartOrderingUnits.includes(unit as CartOrderingUnit) ? unit as CartOrderingUnit : null;
}

export function cartOrderingUnit(match: Pick<StoreItemMatch, "storeItem" | "quantityUnitVerification">): CartOrderingUnit | null {
  const verified = match.quantityUnitVerification;
  if (verified && verified.productId === match.storeItem.productId && verified.upc === match.storeItem.upc
    && normalizeCartOrderingUnit(verified.unit)) return normalizeCartOrderingUnit(verified.unit);
  if (match.storeItem.soldBy?.trim().toUpperCase() === "UNIT") {
    return "each";
  }
  // Neither pricing weight nor average weight proves the cart's input unit.
  return null;
}

export function cartOrderingUnitLabel(unit: CartOrderingUnit | null) {
  switch (unit) {
    case "each": return "Count (ct/each)";
    case null: return "verify on QFC";
    default: return unit;
  }
}

export function storeItemUnits(candidate: Pick<StoreItemCandidate, "size" | "soldBy">) {
  const soldBy = candidate.soldBy?.trim().toUpperCase();
  const weightPriced = soldBy === "WEIGHT";
  // Only label a price per pound when the catalog explicitly supplies that basis.
  const priceUnit = weightPriced && /^1\s*lbs?\.?$/i.test(candidate.size.trim()) ? "lb" : null;
  const sizeLabel = candidate.size
    ? `${weightPriced ? "Pricing size" : soldBy === "UNIT" ? "Package size" : "Catalog size"}: ${candidate.size}`
    : "Size unavailable";
  return { priceUnit, sizeLabel };
}
