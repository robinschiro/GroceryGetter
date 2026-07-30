import type {
  CustomShoppingList,
  CustomShoppingListInput
} from "../../../shared/contracts/index.js";
import type { ApiRequest } from "../../shared/apiClient.js";

export function listShoppingLists(api: ApiRequest) {
  return api<CustomShoppingList[]>("/api/custom-shopping-lists");
}

export function createShoppingList(api: ApiRequest, input: CustomShoppingListInput) {
  return api<CustomShoppingList>("/api/custom-shopping-lists", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateShoppingList(
  api: ApiRequest,
  shoppingListId: number,
  input: CustomShoppingListInput
) {
  return api<CustomShoppingList>(`/api/custom-shopping-lists/${shoppingListId}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function deleteShoppingList(api: ApiRequest, shoppingListId: number) {
  return api<{ ok: true }>(`/api/custom-shopping-lists/${shoppingListId}`, {
    method: "DELETE"
  });
}
