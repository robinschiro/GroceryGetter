import { useState } from "react";
import type {
  Menu,
  Recipe,
  RecipeCategory,
  ShoppingListItem
} from "../../../shared/contracts/index.js";
import type { ApiRequest } from "../../shared/apiClient.js";
import { recipeCategories } from "../../shared/recipeCategories.js";
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
  updateMenuShoppingLists,
  updateShoppingListApproval,
  updateShoppingListItems
} from "./api.js";

export function usePlanner({
  api,
  recipes,
  onSourcesChanged,
  onStoreReviewInvalidated
}: {
  api: ApiRequest;
  recipes: Recipe[];
  onSourcesChanged: () => Promise<void>;
  onStoreReviewInvalidated: () => void;
}) {
  const [activeMenu, setActiveMenu] = useState<Menu | null>(null);
  const [shoppingList, setShoppingList] = useState<ShoppingListItem[]>([]);
  const [dirtyShoppingItemIds, setDirtyShoppingItemIds] = useState<Set<number>>(() => new Set());
  const [sourceMetadataDirtyItemIds, setSourceMetadataDirtyItemIds] = useState<Set<number>>(() => new Set());
  const [savingSourceItemIds, setSavingSourceItemIds] = useState<Set<number>>(() => new Set());
  const [mealCount, setMealCount] = useState<number | "">(2);
  const [message, setMessage] = useState("");

  function invalidateGeneratedList() {
    setShoppingList([]);
    setDirtyShoppingItemIds(new Set());
    setSourceMetadataDirtyItemIds(new Set());
    onStoreReviewInvalidated();
  }

  function reset(message = "") {
    setActiveMenu(null);
    invalidateGeneratedList();
    setMealCount(2);
    setMessage(message);
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
    setMessage("");
    if (mealCount === "" || mealCount < 1 || mealCount > 14) {
      setMessage("Meal count must be between 1 and 14.");
      return;
    }

    try {
      setActiveMenu(await previewMenu(api, mealCount));
      invalidateGeneratedList();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to generate menu.");
    }
  }

  async function saveMenu() {
    if (!activeMenu) return;
    if (activeMenu.id !== null) {
      setMessage("Menu is already saved.");
      return;
    }

    setMessage("");
    try {
      const created = await createMenu(api, activeMenu);
      setActiveMenu(await getMenu(api, created.id));
      invalidateGeneratedList();
      setMessage("Menu saved.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to save menu.");
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
      setMessage("Select at least one entree recipe for menu generation before adding a meal.");
      return;
    }

    setMessage("");
    try {
      const nextMenu = activeMenu.id === null
        ? { ...activeMenu, mealCount: nextMealNumber, items: [...activeMenu.items, ...newItems] }
        : await addMenuMeal(api, activeMenu.id, newItems);
      setActiveMenu(nextMenu);
      setMealCount(nextMenu.mealCount);
      invalidateGeneratedList();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to add meal.");
    }
  }

  async function removeMeal(mealNumber: number) {
    if (!activeMenu || activeMenu.mealCount <= 1) return;

    setMessage("");
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
      setMessage(err instanceof Error ? err.message : "Unable to remove meal.");
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
      await clearShoppingList(api, activeMenu.id);
    }
  }

  async function aggregateIngredients() {
    if (!activeMenu) return;
    if (activeMenu.id === null) {
      setMessage("Save the menu before aggregating ingredients.");
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
    setMessage("");
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

  async function saveShoppingItemToSource(item: ShoppingListItem) {
    if (!activeMenu?.id || savingSourceItemIds.has(item.id)) return false;

    setMessage("");
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
      setMessage(`Saved item details to ${item.sourceNames}. Re-aggregate to apply any new grouping.`);
      return true;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to save item details to the source.");
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
    message,
    removeMeal,
    reset,
    saveDirtyShoppingItems,
    saveMenu,
    saveShoppingItemApproval,
    saveShoppingItemToSource,
    savingSourceItemIds,
    setMealCount,
    setMessage,
    setShoppingList,
    shoppingList,
    sourceMetadataDirtyItemIds,
    updateCustomShoppingListSelection,
    updateMenuItem
  };
}
