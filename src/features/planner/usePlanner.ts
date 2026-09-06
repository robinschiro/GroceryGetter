import { useState } from "react";
import type {
  Menu,
  OurGroceriesListSummary,
  Recipe,
  RecipeCategory,
  ShoppingListItem
} from "../../../shared/contracts/index.js";
import type { ApiRequest } from "../../shared/apiClient.js";
import { recipeCategories } from "../../shared/recipeCategories.js";
import type { ToastVariant } from "../../shared/Toast.js";
import {
  addMenuMeal,
  aggregateShoppingList,
  clearShoppingList,
  createMenu,
  getLatestMenu,
  getMenu,
  getShoppingList,
  previewMenu,
  removeMenuMeal,
  saveShoppingListItemToSource,
  updateMenuItem as updateMenuItemRequest,
  updateMenuOurGroceriesList,
  updateMenuShoppingLists,
  updateShoppingListApproval,
  updateShoppingListPantryStatus,
  updateShoppingListItems
} from "./api.js";

export function usePlanner({
  api,
  recipes,
  onSourcesChanged,
  onStoreReviewInvalidated,
  notify
}: {
  api: ApiRequest;
  recipes: Recipe[];
  onSourcesChanged: () => Promise<void>;
  onStoreReviewInvalidated: () => void;
  notify: (message: string, variant?: ToastVariant) => void;
}) {
  const [activeMenu, setActiveMenu] = useState<Menu | null>(null);
  const [shoppingList, setShoppingList] = useState<ShoppingListItem[]>([]);
  const [dirtyShoppingItemIds, setDirtyShoppingItemIds] = useState<Set<number>>(() => new Set());
  const [sourceMetadataDirtyItemIds, setSourceMetadataDirtyItemIds] = useState<Set<number>>(() => new Set());
  const [savingSourceItemIds, setSavingSourceItemIds] = useState<Set<number>>(() => new Set());
  const [savingPantryItemIds, setSavingPantryItemIds] = useState<Set<number>>(() => new Set());
  const [mealCount, setMealCount] = useState<number | "">(2);

  function invalidateGeneratedList() {
    setShoppingList([]);
    setDirtyShoppingItemIds(new Set());
    setSourceMetadataDirtyItemIds(new Set());
    onStoreReviewInvalidated();
  }

  function reset() {
    setActiveMenu(null);
    invalidateGeneratedList();
    setMealCount(2);
  }

  async function loadLatestMenu() {
    const latestMenu = await getLatestMenu(api);
    if (!latestMenu || latestMenu.id === null) {
      setActiveMenu(null);
      setShoppingList([]);
      return;
    }

    const latestShoppingList = await getShoppingList(api, latestMenu.id);
    setActiveMenu(latestMenu);
    setShoppingList(latestShoppingList);
    setMealCount(latestMenu.mealCount);
  }

  async function loadMenu(id: number) {
    setActiveMenu(await getMenu(api, id));
  }

  async function generateMenu() {
    if (mealCount === "" || mealCount < 1 || mealCount > 14) {
      notify("Meal count must be between 1 and 14.", "error");
      return;
    }

    try {
      setActiveMenu(await previewMenu(api, mealCount));
      invalidateGeneratedList();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Unable to generate menu.", "error");
    }
  }

  async function saveMenu() {
    if (!activeMenu) return;
    if (activeMenu.id !== null) {
      notify("Menu is already saved.", "info");
      return;
    }

    try {
      const created = await createMenu(api, activeMenu);
      setActiveMenu(await getMenu(api, created.id));
      invalidateGeneratedList();
      notify("Menu saved.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Unable to save menu.", "error");
    }
  }

  async function updateMenuItem(
    menuItemId: number | null,
    mealNumber: number,
    slot: RecipeCategory,
    recipeId: number | null
  ) {
    if (menuItemId === null) {
      const recipe = recipeId === null ? null : recipes.find((item) => item.id === recipeId);
      if (!activeMenu || (recipeId !== null && !recipe)) return;
      setActiveMenu({
        ...activeMenu,
        items: activeMenu.items.map((item) =>
          item.mealNumber === mealNumber && item.slot === slot
            ? { ...item, recipeId, recipeName: recipe?.name ?? null }
            : item
        )
      });
      invalidateGeneratedList();
      return;
    }

    await updateMenuItemRequest(api, menuItemId, recipeId);
    if (activeMenu?.id != null) {
      await loadMenu(activeMenu.id);
      invalidateGeneratedList();
    }
  }

  async function addMeal() {
    if (!activeMenu || activeMenu.mealCount >= 14) return;

    const nextMealNumber = activeMenu.mealCount + 1;
    const newItems = recipeCategories.map(({ value: slot }) => {
      const matchingRecipes = recipes.filter(
        (recipe) => recipe.category === slot && recipe.includeInMenuGeneration
      );
      const recipe = matchingRecipes[(nextMealNumber - 1) % matchingRecipes.length] ?? null;
      return {
        id: null,
        mealNumber: nextMealNumber,
        slot,
        recipeId: recipe?.id ?? null,
        recipeName: recipe?.name ?? null
      };
    });

    if (newItems.find((item) => item.slot === "entree")?.recipeId === null) {
      notify("Select at least one entree recipe for menu generation before adding a meal.", "error");
      return;
    }

    try {
      const nextMenu = activeMenu.id === null
        ? { ...activeMenu, mealCount: nextMealNumber, items: [...activeMenu.items, ...newItems] }
        : await addMenuMeal(api, activeMenu.id, newItems);
      setActiveMenu(nextMenu);
      setMealCount(nextMenu.mealCount);
      invalidateGeneratedList();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Unable to add meal.", "error");
    }
  }

  async function removeMeal(mealNumber: number) {
    if (!activeMenu || activeMenu.mealCount <= 1) return;

    try {
      const nextMenu = activeMenu.id === null
        ? {
          ...activeMenu,
          mealCount: activeMenu.mealCount - 1,
          items: activeMenu.items
            .filter((item) => item.mealNumber !== mealNumber)
            .map((item) => item.mealNumber > mealNumber
              ? { ...item, mealNumber: item.mealNumber - 1 }
              : item)
        }
        : await removeMenuMeal(api, activeMenu.id, mealNumber);
      setActiveMenu(nextMenu);
      setMealCount(nextMenu.mealCount);
      invalidateGeneratedList();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Unable to remove meal.", "error");
    }
  }

  async function updateCustomShoppingListSelection(listId: number, included: boolean) {
    if (!activeMenu) return;
    const nextIds = included
      ? Array.from(new Set([...activeMenu.customShoppingListIds, listId]))
      : activeMenu.customShoppingListIds.filter((id) => id !== listId);

    setActiveMenu({ ...activeMenu, customShoppingListIds: nextIds });
    invalidateGeneratedList();

    if (activeMenu.id !== null) {
      await updateMenuShoppingLists(api, activeMenu.id, nextIds);
    }
  }

  async function updateOurGroceriesListSelection(list: OurGroceriesListSummary | null) {
    if (!activeMenu) return;

    setActiveMenu({ ...activeMenu, ourGroceriesList: list });
    invalidateGeneratedList();

    if (activeMenu.id !== null) {
      const updated = await updateMenuOurGroceriesList(api, activeMenu.id, list?.id ?? null);
      setActiveMenu(updated);
    }
  }

  async function aggregateIngredients() {
    if (!activeMenu) return;
    if (activeMenu.id === null) {
      notify("Save the menu before aggregating ingredients.", "error");
      return;
    }
    await aggregateShoppingList(api, activeMenu.id);
    setShoppingList(await getShoppingList(api, activeMenu.id));
    setDirtyShoppingItemIds(new Set());
    setSourceMetadataDirtyItemIds(new Set());
    onStoreReviewInvalidated();
  }

  async function clearAggregatedIngredients() {
    if (!activeMenu?.id) return;
    await clearShoppingList(api, activeMenu.id);
    invalidateGeneratedList();
  }

  async function saveDirtyShoppingItems() {
    if (!activeMenu?.id) return;
    const dirtyItems = shoppingList.filter((item) => dirtyShoppingItemIds.has(item.id));
    if (!dirtyItems.length) return;

    await updateShoppingListItems(
      api,
      activeMenu.id,
      dirtyItems.map((item) => ({ ...item, approved: item.approved ? 1 : 0 }))
    );

    setDirtyShoppingItemIds((current) => {
      const next = new Set(current);
      dirtyItems.forEach((item) => next.delete(item.id));
      return next;
    });
  }

  async function saveShoppingItemApproval(itemId: number, approved: boolean) {
    if (!activeMenu?.id) return;
    await updateShoppingListApproval(api, activeMenu.id, itemId, approved);
  }

  async function updateShoppingItemPantryStatus(itemId: number, isPantry: boolean) {
    if (!activeMenu?.id || savingPantryItemIds.has(itemId)) return null;
    const previousItem = shoppingList.find((item) => item.id === itemId);
    if (!previousItem) return null;

    setSavingPantryItemIds((current) => new Set(current).add(itemId));
    try {
      const result = await updateShoppingListPantryStatus(
        api,
        activeMenu.id,
        itemId,
        isPantry
      );
      setShoppingList((current) => current.map((item) =>
        item.id === itemId ? result.item : item
      ));
      if (Boolean(result.item.approved) !== Boolean(previousItem.approved)) {
        onStoreReviewInvalidated();
      }

      const hasActiveOurGroceriesItem = result.item.sourceTargets.some(
        (source) => source.type === "ourGroceries"
      ) && Boolean(result.item.approved);
      notify(isPantry
        ? hasActiveOurGroceriesItem
          ? `${result.ingredientName} marked as pantry, but kept because it is active in OurGroceries.`
          : result.item.automaticExclusionReason === "pantry"
            ? `${result.ingredientName} marked as pantry and moved to unchecked ingredients.`
            : `${result.ingredientName} marked as pantry; its manual cross-off was preserved.`
        : result.item.approved && !previousItem.approved
          ? `${result.ingredientName} removed from pantry and restored to this menu.`
          : `${result.ingredientName} removed from pantry.`);
      return result.item;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to update pantry status.", "error");
      return null;
    } finally {
      setSavingPantryItemIds((current) => {
        const next = new Set(current);
        next.delete(itemId);
        return next;
      });
    }
  }

  async function saveShoppingItemToSource(item: ShoppingListItem) {
    if (!activeMenu?.id || savingSourceItemIds.has(item.id)) return false;

    setSavingSourceItemIds((current) => new Set(current).add(item.id));
    try {
      const result = await saveShoppingListItemToSource(api, activeMenu.id, item);
      setShoppingList((current) => current.map((candidate) => (
        candidate.id === item.id ? result.item : candidate
      )));
      setDirtyShoppingItemIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      setSourceMetadataDirtyItemIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      onStoreReviewInvalidated();
      await onSourcesChanged();
      notify(`Saved item details to ${item.sourceNames}. Re-aggregate to apply any new grouping.`);
      return true;
    } catch (err) {
      notify(err instanceof Error ? err.message : "Unable to save item details to the source.", "error");
      return false;
    } finally {
      setSavingSourceItemIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }

  return {
    activeMenu,
    addMeal,
    aggregateIngredients,
    clearAggregatedIngredients,
    dirtyShoppingItemIds,
    generateMenu,
    loadLatestMenu,
    loadMenu,
    mealCount,
    removeMeal,
    reset,
    saveDirtyShoppingItems,
    saveMenu,
    saveShoppingItemApproval,
    saveShoppingItemToSource,
    savingPantryItemIds,
    savingSourceItemIds,
    setMealCount,
    setShoppingList,
    shoppingList,
    sourceMetadataDirtyItemIds,
    updateCustomShoppingListSelection,
    updateOurGroceriesListSelection,
    updateShoppingItemPantryStatus,
    updateMenuItem
  };
}
