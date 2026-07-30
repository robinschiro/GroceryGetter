import type {
  QfcCartSkip,
  QfcLocation,
  QfcStatus,
  QfcSubmitJob,
  ShoppingListItem,
  StoreItemCandidate,
  StoreItemMatch,
  StoreItemPreference
} from "../../../shared/contracts/index.js";
import type { ApiRequest } from "../../shared/apiClient.js";

export type StoreItemReviewRemoval = {
  removedItem: ShoppingListItem;
  items: ShoppingListItem[];
  matched: StoreItemMatch[];
  skipped: QfcCartSkip[];
};

export type StoreItemReviewSearchResult = {
  match: StoreItemMatch | null;
  items: ShoppingListItem[];
  matched: StoreItemMatch[];
  skipped: QfcCartSkip[];
  resultCount: number;
};

export async function loadQfcSettings(api: ApiRequest) {
  const [settings, preferences, status] = await Promise.all([
    api<Record<string, string>>("/api/settings"),
    api<StoreItemPreference[]>("/api/store-item-preferences"),
    api<QfcStatus>("/api/qfc/status")
  ]);
  return { settings, preferences, status };
}

export function updateScopedSetting(api: ApiRequest, key: "preferStoreBrands" | "allowRealQfcCartMutation", value: boolean) {
  return api(`/api/settings/${key}`, {
    method: "PUT",
    body: JSON.stringify({ value: String(value) })
  });
}

export function saveQfcSettings(api: ApiRequest, settings: Record<string, string | undefined>) {
  return api("/api/qfc/settings", {
    method: "PUT",
    body: JSON.stringify(settings)
  });
}

export function startCustomerOAuth(api: ApiRequest) {
  return api<{ authorizationUrl: string }>("/api/qfc/oauth/start", { method: "POST" });
}

export function refreshCustomerOAuth(api: ApiRequest) {
  return api("/api/qfc/oauth/refresh", { method: "POST" });
}

export function searchQfcLocations(api: ApiRequest, query: string) {
  return api<QfcLocation[]>(`/api/qfc/locations?query=${encodeURIComponent(query)}`);
}

export function searchQfcStoreItems(api: ApiRequest, term: string, locationId = "") {
  const params = new URLSearchParams({ term });
  if (locationId.trim()) params.set("locationId", locationId.trim());
  return api<StoreItemCandidate[]>(`/api/qfc/store-items?${params.toString()}`);
}

export function deleteStoreItemPreference(api: ApiRequest, provider: string, ingredientKey: string) {
  return api(
    `/api/store-item-preferences/${encodeURIComponent(provider)}/${encodeURIComponent(ingredientKey)}`,
    { method: "DELETE" }
  );
}

export function startStoreItemPreview(api: ApiRequest, menuId: number) {
  return api<QfcSubmitJob>(`/api/menus/${menuId}/preview-qfc`, { method: "POST" });
}

export function getQfcSubmitJob(api: ApiRequest, jobId: string) {
  return api<QfcSubmitJob>(`/api/qfc/submit-jobs/${jobId}`);
}

export function startAddToCart(api: ApiRequest, previewJobId: string) {
  return api<QfcSubmitJob>(`/api/qfc/submit-jobs/${previewJobId}/add-to-cart`, {
    method: "POST"
  });
}

export function selectStoreItem(
  api: ApiRequest,
  jobId: string,
  shoppingItemId: number,
  productId: string,
  upc: string,
  rememberPreference: boolean
) {
  return api<{ match: StoreItemMatch; preference: StoreItemPreference | null }>(
    `/api/store-item-reviews/${jobId}/selections/${shoppingItemId}`,
    {
      method: "PUT",
      body: JSON.stringify({ productId, upc, rememberPreference })
    }
  );
}

export function updateStoreItemQuantity(
  api: ApiRequest,
  jobId: string,
  shoppingItemId: number,
  cartQuantity: number
) {
  return api<{ match: StoreItemMatch }>(
    `/api/store-item-reviews/${jobId}/quantities/${shoppingItemId}`,
    {
      method: "PUT",
      body: JSON.stringify({ cartQuantity })
    }
  );
}

export function searchStoreItemsForReview(
  api: ApiRequest,
  jobId: string,
  shoppingItemId: number,
  term: string
) {
  return api<StoreItemReviewSearchResult>(
    `/api/store-item-reviews/${jobId}/items/${shoppingItemId}/search`,
    {
      method: "POST",
      body: JSON.stringify({ term })
    }
  );
}

export function removeStoreItemFromReview(api: ApiRequest, jobId: string, shoppingItemId: number) {
  return api<StoreItemReviewRemoval>(
    `/api/store-item-reviews/${jobId}/items/${shoppingItemId}`,
    { method: "DELETE" }
  );
}
