import type {
  Menu,
  MenuSummary,
  ShoppingListItem
} from "../../../shared/contracts/index.js";
import type { ApiRequest } from "../../shared/apiClient.js";

export function previewMenu(api: ApiRequest, mealCount: number) {
  return api<Menu>("/api/menus/preview", {
    method: "POST",
    body: JSON.stringify({ mealCount })
  });
}

export function createMenu(api: ApiRequest, menu: Menu) {
  return api<{ id: number }>("/api/menus", {
    method: "POST",
    body: JSON.stringify({
      name: menu.name,
      mealCount: menu.mealCount,
      customShoppingListIds: menu.customShoppingListIds,
      ourGroceriesListId: menu.ourGroceriesList?.id ?? null,
      items: menu.items.map(({ mealNumber, slot, recipeId }) => ({
        mealNumber,
        slot,
        recipeId
      }))
    })
  });
}

export function getMenu(api: ApiRequest, menuId: number) {
  return api<Menu>(`/api/menus/${menuId}`);
}

export function getLatestMenu(api: ApiRequest) {
  return api<Menu | null>("/api/menus/latest");
}

export function listMenus(api: ApiRequest) {
  return api<MenuSummary[]>("/api/menus");
}

export function deleteMenu(api: ApiRequest, menuId: number) {
  return api<{ id: number }>(`/api/menus/${menuId}`, { method: "DELETE" });
}

export function addMenuMeal(api: ApiRequest, menuId: number, items: Menu["items"]) {
  return api<Menu>(`/api/menus/${menuId}/meals`, {
    method: "POST",
    body: JSON.stringify({
      items: items.map(({ mealNumber, slot, recipeId }) => ({ mealNumber, slot, recipeId }))
    })
  });
}

export function removeMenuMeal(api: ApiRequest, menuId: number, mealNumber: number) {
  return api<Menu>(`/api/menus/${menuId}/meals/${mealNumber}`, { method: "DELETE" });
}

export function updateMenuItem(
  api: ApiRequest,
  menuItemId: number,
  recipeId: number | null
) {
  return api<{ ok: true }>(`/api/menu-items/${menuItemId}`, {
    method: "PUT",
    body: JSON.stringify({ recipeId })
  });
}

export function updateMenuShoppingLists(
  api: ApiRequest,
  menuId: number,
  customShoppingListIds: number[]
) {
  return api<{ ok: true }>(`/api/menus/${menuId}/custom-shopping-lists`, {
    method: "PUT",
    body: JSON.stringify({ customShoppingListIds })
  });
}

export function updateMenuOurGroceriesList(
  api: ApiRequest,
  menuId: number,
  listId: string | null
) {
  return api<Menu>(`/api/menus/${menuId}/ourgroceries-list`, {
    method: "PUT",
    body: JSON.stringify({ listId })
  });
}

export function aggregateShoppingList(api: ApiRequest, menuId: number) {
  return api<{ ok: true }>(`/api/menus/${menuId}/aggregate`, { method: "POST" });
}

export function getShoppingList(api: ApiRequest, menuId: number) {
  return api<ShoppingListItem[]>(`/api/menus/${menuId}/shopping-list`);
}

export function clearShoppingList(api: ApiRequest, menuId: number) {
  return api<{ ok: true }>(`/api/menus/${menuId}/shopping-list`, { method: "DELETE" });
}

export function updateShoppingListItems(
  api: ApiRequest,
  menuId: number,
  items: ShoppingListItem[]
) {
  return api<{ ok: true }>(`/api/menus/${menuId}/shopping-list/items`, {
    method: "PUT",
    body: JSON.stringify({ items })
  });
}

export function updateShoppingListApproval(
  api: ApiRequest,
  menuId: number,
  itemId: number,
  approved: boolean
) {
  return api<{ ok: true }>(
    `/api/menus/${menuId}/shopping-list/items/${itemId}/approval`,
    {
      method: "PATCH",
      body: JSON.stringify({ approved })
    }
  );
}

export function saveShoppingListItemToSource(
  api: ApiRequest,
  menuId: number,
  item: ShoppingListItem
) {
  return api<{
    item: ShoppingListItem;
    sourceType: "recipe" | "custom";
    sourceId: number;
  }>(`/api/menus/${menuId}/shopping-list/items/${item.id}/source`, {
    method: "PATCH",
    body: JSON.stringify({ item: item.item })
  });
}
