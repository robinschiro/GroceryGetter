import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BookmarkPlus,
  Check,
  ChevronRight,
  Database,
  ExternalLink,
  ListChecks,
  LoaderCircle,
  Menu as MenuIcon,
  Minus,
  Moon,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Shuffle,
  Sun,
  Trash2,
  X
} from "lucide-react";
import {
  defaultRouteForView,
  recipeEditRoute,
  routeFromPathname,
  shoppingListEditRoute,
  type AppRoute,
  type AppView,
  type QfcSettingsTab
} from "./router.js";
import type {
  CustomShoppingList,
  DataScope,
  Menu,
  MenuItem,
  QfcCartSkip,
  QfcLocation,
  QfcStatus,
  QfcSubmitJob,
  QfcSubmitProgress,
  Recipe,
  RecipeCategory,
  ShoppingListItem,
  ShoppingListSourceTarget,
  StoreItemCandidate,
  StoreItemMatch,
  StoreItemPreference
} from "../../shared/contracts/index.js";
import { createApiClient, type ApiRequest } from "../shared/apiClient.js";
import { listRecipes } from "../features/recipes/api.js";
import {
  RecipesPage,
  recipeCategories
} from "../features/recipes/RecipesPage.js";
import { listShoppingLists } from "../features/shoppingLists/api.js";
import { ShoppingListsPage } from "../features/shoppingLists/ShoppingListsPage.js";
import { MenuBuilder } from "../features/planner/MenuBuilder.js";
import { ShoppingListReview } from "../features/planner/ShoppingListReview.js";
import { QfcSubmitProgressBar } from "../features/qfc/QfcSubmitProgressBar.js";
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
} from "../features/planner/api.js";

type ThemeMode = "light" | "dark";

type StoreItemReview = {
  jobId: string;
  result: NonNullable<QfcSubmitJob["result"]>;
};

type StoreItemReviewRemoval = {
  removedItem: ShoppingListItem;
  items: ShoppingListItem[];
  matched: StoreItemMatch[];
  skipped: QfcCartSkip[];
};

type StoreItemReviewSearchResult = {
  match: StoreItemMatch | null;
  items: ShoppingListItem[];
  matched: StoreItemMatch[];
  skipped: QfcCartSkip[];
  resultCount: number;
};

const categories = recipeCategories;
const qfcCartUrl = "https://www.qfc.com/cart";
const themeStorageKey = "grocery-getter-theme";
const dataScopeStorageKey = "grocery-getter-data-scope";

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const views: Array<{ id: AppView; label: string; title: string; eyebrow: string; icon: typeof Shuffle }> = [
  { id: "planner", label: "Planner", title: "Planner", eyebrow: "Weekly menu workflow", icon: Shuffle },
  { id: "recipe-admin", label: "Recipes", title: "Recipes", eyebrow: "Recipe library", icon: Database },
  {
    id: "shopping-lists",
    label: "Shopping Lists",
    title: "Shopping Lists",
    eyebrow: "Reusable grocery templates",
    icon: ListChecks
  },
  { id: "qfc-api", label: "QFC Settings", title: "QFC Settings", eyebrow: "Integration settings", icon: Settings }
];

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function browserQfcCallbackUri() {
  return `${window.location.origin}/api/qfc/oauth/callback`;
}

function getInitialTheme(): ThemeMode {
  return window.localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light";
}

function getInitialDataScope(): DataScope {
  return window.localStorage.getItem(dataScopeStorageKey) === "sandbox" ? "sandbox" : "production";
}

export function App() {
  const [activeRoute, setActiveRoute] = useState<AppRoute>(() => routeFromPathname(window.location.pathname));
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialTheme);
  const [dataScope, setDataScope] = useState<DataScope>(getInitialDataScope);
  const api = useMemo(() => createApiClient(dataScope).request, [dataScope]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [customShoppingLists, setCustomShoppingLists] = useState<CustomShoppingList[]>([]);
  const [activeMenu, setActiveMenu] = useState<Menu | null>(null);
  const [shoppingList, setShoppingList] = useState<ShoppingListItem[]>([]);
  const [dirtyShoppingItemIds, setDirtyShoppingItemIds] = useState<Set<number>>(() => new Set());
  const [sourceMetadataDirtyItemIds, setSourceMetadataDirtyItemIds] = useState<Set<number>>(() => new Set());
  const [savingApprovalItemIds, setSavingApprovalItemIds] = useState<Set<number>>(() => new Set());
  const [searchingStoreItemIds, setSearchingStoreItemIds] = useState<Set<number>>(() => new Set());
  const [savingSourceItemIds, setSavingSourceItemIds] = useState<Set<number>>(() => new Set());
  const [mealCount, setMealCount] = useState<number | "">(2);
  const [message, setMessage] = useState("");
  const [preferStoreBrands, setPreferStoreBrands] = useState(true);
  const [allowRealQfcCartMutation, setAllowRealQfcCartMutation] = useState(true);
  const [qfcStatus, setQfcStatus] = useState<QfcStatus | null>(null);
  const [qfcSubmitProgress, setQfcSubmitProgress] = useState<QfcSubmitProgress | null>(null);
  const [storeItemReview, setStoreItemReview] = useState<StoreItemReview | null>(null);
  const [storeItemReviewMessage, setStoreItemReviewMessage] = useState("");
  const [storeItemPreferences, setStoreItemPreferences] = useState<StoreItemPreference[]>([]);

  async function loadRecipes() {
    setRecipes(await listRecipes(api));
  }

  async function loadCustomShoppingLists() {
    setCustomShoppingLists(await listShoppingLists(api));
  }

  async function loadSettings() {
    const [settings, preferences] = await Promise.all([
      api<Record<string, string>>("/api/settings"),
      api<StoreItemPreference[]>("/api/store-item-preferences")
    ]);
    setPreferStoreBrands(settings.preferStoreBrands === "true");
    setAllowRealQfcCartMutation(settings.allowRealQfcCartMutation === "true");
    setStoreItemPreferences(preferences);
    setQfcStatus(await api<QfcStatus>("/api/qfc/status"));
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

  useEffect(() => {
    void loadRecipes();
    void loadCustomShoppingLists();
    void loadSettings();
    void loadLatestMenu();
  }, [dataScope]);

  useEffect(() => {
    function syncRouteFromUrl() {
      const nextRoute = routeFromPathname(window.location.pathname);
      if (window.location.pathname !== nextRoute.path) {
        window.history.replaceState(null, "", nextRoute.path);
      }
      setActiveRoute(nextRoute);
      setIsMenuOpen(false);
    }

    syncRouteFromUrl();
    window.addEventListener("popstate", syncRouteFromUrl);
    return () => window.removeEventListener("popstate", syncRouteFromUrl);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem(themeStorageKey, themeMode);
  }, [themeMode]);

  useLayoutEffect(() => {
    document.documentElement.dataset.dataScope = dataScope;
  }, [dataScope]);

  async function generateMenu() {
    setMessage("");
    if (mealCount === "" || mealCount < 1 || mealCount > 14) {
      setMessage("Meal count must be between 1 and 14.");
      return;
    }

    try {
      const preview = await previewMenu(api, mealCount);
      setActiveMenu(preview);
      setShoppingList([]);
      setDirtyShoppingItemIds(new Set());
      setSourceMetadataDirtyItemIds(new Set());
      setStoreItemReview(null);
      setStoreItemReviewMessage("");
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
      setShoppingList([]);
      setDirtyShoppingItemIds(new Set());
      setSourceMetadataDirtyItemIds(new Set());
      setStoreItemReview(null);
      setStoreItemReviewMessage("");
      setMessage("Menu saved.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to save menu.");
    }
  }

  function updateDataScope(next: DataScope) {
    window.localStorage.setItem(dataScopeStorageKey, next);
    setDataScope(next);
    setRecipes([]);
    setCustomShoppingLists([]);
    setActiveMenu(null);
    setShoppingList([]);
    setDirtyShoppingItemIds(new Set());
    setSourceMetadataDirtyItemIds(new Set());
    setStoreItemReview(null);
    setStoreItemReviewMessage("");
    setMessage(next === "sandbox" ? "Sandbox mode is active." : "");
  }

  async function loadMenu(id: number) {
    setActiveMenu(await getMenu(api, id));
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
      setShoppingList([]);
      setDirtyShoppingItemIds(new Set());
      setSourceMetadataDirtyItemIds(new Set());
      setStoreItemReview(null);
      setStoreItemReviewMessage("");
      return;
    }

    await updateMenuItemRequest(api, menuItemId, recipeId);
    if (activeMenu?.id != null) {
      await loadMenu(activeMenu.id);
      setShoppingList([]);
      setDirtyShoppingItemIds(new Set());
      setSourceMetadataDirtyItemIds(new Set());
      setStoreItemReview(null);
      setStoreItemReviewMessage("");
    }
  }

  async function addMeal() {
    if (!activeMenu || activeMenu.mealCount >= 14) return;

    const nextMealNumber = activeMenu.mealCount + 1;
    const newItems = categories.map(({ value: slot }) => {
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
      setShoppingList([]);
      setDirtyShoppingItemIds(new Set());
      setSourceMetadataDirtyItemIds(new Set());
      setStoreItemReview(null);
      setStoreItemReviewMessage("");
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
      setShoppingList([]);
      setDirtyShoppingItemIds(new Set());
      setSourceMetadataDirtyItemIds(new Set());
      setStoreItemReview(null);
      setStoreItemReviewMessage("");
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
    setShoppingList([]);
    setDirtyShoppingItemIds(new Set());
    setSourceMetadataDirtyItemIds(new Set());
    setStoreItemReview(null);
    setStoreItemReviewMessage("");

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
    setStoreItemReview(null);
    setStoreItemReviewMessage("");
  }

  async function clearAggregatedIngredients() {
    if (!activeMenu?.id) return;
    await clearShoppingList(api, activeMenu.id);
    setShoppingList([]);
    setDirtyShoppingItemIds(new Set());
    setSourceMetadataDirtyItemIds(new Set());
    setStoreItemReview(null);
    setStoreItemReviewMessage("");
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

  async function updateShoppingItemApproval(itemId: number, approved: boolean) {
    if (!activeMenu?.id || savingApprovalItemIds.has(itemId)) return;
    const previousItem = shoppingList.find((item) => item.id === itemId);
    if (!previousItem) return;
    const currentReview = storeItemReview;

    setMessage("");
    setStoreItemReviewMessage("");
    setShoppingList((current) => current.map((item) => (
      item.id === itemId ? { ...item, approved: approved ? 1 : 0 } : item
    )));
    setSavingApprovalItemIds((current) => new Set(current).add(itemId));
    if (approved && currentReview) {
      setSearchingStoreItemIds((current) => new Set(current).add(itemId));
    }

    try {
      await updateShoppingListApproval(api, activeMenu.id, itemId, approved);

      if (
        !approved
        && currentReview
        && currentReview.result.items.some((reviewItem) => reviewItem.id === itemId)
      ) {
        try {
          const result = await api<StoreItemReviewRemoval>(
            `/api/store-item-reviews/${currentReview.jobId}/items/${itemId}`,
            { method: "DELETE" }
          );
          setStoreItemReview((review) => review?.jobId === currentReview.jobId ? {
            ...review,
            result: {
              ...review.result,
              items: result.items,
              matched: result.matched,
              skipped: result.skipped
            }
          } : review);
        } catch (err) {
          setStoreItemReview((review) => review?.jobId === currentReview.jobId ? null : review);
          setStoreItemReviewMessage(
            err instanceof Error
              ? `The ingredient was removed, but the store item review could not be updated: ${err.message}`
              : "The ingredient was removed, but the store item review could not be updated. Preview store items again."
          );
        }
      }

      if (approved && currentReview) {
        try {
          const result = await api<StoreItemReviewSearchResult>(
            `/api/store-item-reviews/${currentReview.jobId}/items/${itemId}/search`,
            {
              method: "POST",
              body: JSON.stringify({ term: previousItem.item || previousItem.text })
            }
          );
          setStoreItemReview((review) => review?.jobId === currentReview.jobId ? {
            ...review,
            result: {
              ...review.result,
              items: result.items,
              matched: result.matched,
              skipped: result.skipped
            }
          } : review);
          setStoreItemReviewMessage(
            result.match
              ? `Added ${previousItem.item || previousItem.text} back to the store item review.`
              : `Added ${previousItem.item || previousItem.text} back to the review, but no store items were found.`
          );
        } catch (err) {
          setStoreItemReviewMessage(
            err instanceof Error
              ? `The ingredient was re-added, but its store item search failed: ${err.message}`
              : "The ingredient was re-added, but its store item search failed."
          );
        }
      }
    } catch (err) {
      setShoppingList((current) => current.map((item) => (
        item.id === itemId ? { ...item, approved: previousItem.approved } : item
      )));
      setMessage(err instanceof Error ? err.message : "Unable to save ingredient approval.");
    } finally {
      setSavingApprovalItemIds((current) => {
        const next = new Set(current);
        next.delete(itemId);
        return next;
      });
      setSearchingStoreItemIds((current) => {
        const next = new Set(current);
        next.delete(itemId);
        return next;
      });
    }
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
      setStoreItemReview(null);
      await Promise.all([loadRecipes(), loadCustomShoppingLists()]);
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

  async function previewStoreItems() {
    if (!activeMenu?.id) return;
    const menuId = activeMenu.id;
    setMessage("");

    if (sourceMetadataDirtyItemIds.size) {
      setMessage("Save eligible source changes before matching store items.");
      return;
    }

    if (dirtyShoppingItemIds.size) {
      const shouldSave = window.confirm("You have unsaved ingredient changes. Save them before matching store items?");
      if (!shouldSave) {
        setMessage("Store item matching canceled. Save or discard ingredient changes first.");
        return;
      }

      try {
        setMessage("Saving ingredient changes...");
        await saveDirtyShoppingItems();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Unable to save ingredient changes.");
        return;
      }
    }

    setMessage("");
    setQfcSubmitProgress({
      phase: "checking",
      processedItems: 0,
      totalItems: shoppingList.filter((item) => item.approved).length,
      message: "Starting store item matching..."
    });

    try {
      setStoreItemReview(null);
      setStoreItemReviewMessage("");
      const started = await api<QfcSubmitJob>(`/api/menus/${menuId}/preview-qfc`, { method: "POST" });
      setQfcSubmitProgress(started.progress);

      let job = started;
      while (job.status === "running") {
        await wait(600);
        job = await api<QfcSubmitJob>(`/api/qfc/submit-jobs/${started.id}`);
        setQfcSubmitProgress(job.progress);
      }

      if (job.status === "failed") {
        throw new Error(job.error ?? "Store item matching failed.");
      }

      setMessage(job.result?.message ?? job.progress.message);
      if (job.result) {
        setStoreItemReview({ jobId: started.id, result: job.result });
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Store item matching failed.");
    } finally {
      setQfcSubmitProgress(null);
    }
  }

  async function addReviewedStoreItemsToQfc() {
    if (!storeItemReview || !activeMenu?.id) return;
    setMessage("");
    setStoreItemReviewMessage("");
    setQfcSubmitProgress({
      phase: "adding",
      processedItems: storeItemReview.result.items.length,
      totalItems: storeItemReview.result.items.length,
      message: "Adding reviewed store items to your QFC cart..."
    });

    try {
      const started = await api<QfcSubmitJob>(`/api/qfc/submit-jobs/${storeItemReview.jobId}/add-to-cart`, {
        method: "POST"
      });
      setQfcSubmitProgress(started.progress);
      let job = started;
      while (job.status === "running") {
        await wait(600);
        job = await api<QfcSubmitJob>(`/api/qfc/submit-jobs/${started.id}`);
        setQfcSubmitProgress(job.progress);
      }
      if (job.status === "failed") {
        throw new Error(job.error ?? "QFC cart submission failed.");
      }
      const confirmation = job.result?.message ?? job.progress.message;
      setMessage(confirmation);
      setStoreItemReviewMessage(confirmation);
      await loadMenu(activeMenu.id);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "QFC cart submission failed.");
    } finally {
      setQfcSubmitProgress(null);
    }
  }

  function openQfcCart() {
    window.open(qfcCartUrl, "_blank", "noopener,noreferrer");
  }

  async function updateStoreBrandPreference(next: boolean) {
    setPreferStoreBrands(next);
    setStoreItemReview(null);
    await api("/api/settings/preferStoreBrands", {
      method: "PUT",
      body: JSON.stringify({ value: String(next) })
    });
  }

  async function updateRealQfcCartPermission(next: boolean) {
    setAllowRealQfcCartMutation(next);
    await api("/api/settings/allowRealQfcCartMutation", {
      method: "PUT",
      body: JSON.stringify({ value: String(next) })
    });
  }

  const recipeCounts = useMemo(
    () =>
      categories.map((category) => ({
        ...category,
        count: recipes.filter((recipe) => recipe.category === category.value).length
      })),
    [recipes]
  );

  const activeView = activeRoute.view;
  const currentView = views.find((view) => view.id === activeView) ?? views[0];

  function navigate(route: AppRoute) {
    if (window.location.pathname !== route.path) {
      window.history.pushState(null, "", route.path);
    }
    setActiveRoute(route);
    setIsMenuOpen(false);
  }

  function selectView(view: AppView) {
    navigate(defaultRouteForView(view));
  }

  async function selectStoreItem(shoppingItemId: number, productId: string, upc: string) {
    if (!storeItemReview) return;
    setStoreItemReviewMessage("");
    try {
      const result = await api<{ match: StoreItemMatch; preference: StoreItemPreference }>(
        `/api/store-item-reviews/${storeItemReview.jobId}/selections/${shoppingItemId}`,
        {
          method: "PUT",
          body: JSON.stringify({ productId, upc })
        }
      );
      setStoreItemReview((current) => current ? {
        ...current,
        result: {
          ...current.result,
          matched: current.result.matched?.map((match) =>
            match.item.id === shoppingItemId ? result.match : match
          )
        }
      } : current);
      setStoreItemPreferences((current) => [
        ...current.filter((preference) =>
          preference.provider !== result.preference.provider
          || preference.ingredientKey !== result.preference.ingredientKey
        ),
        result.preference
      ].sort((left, right) => left.ingredientName.localeCompare(right.ingredientName)));
      setStoreItemReviewMessage(`Remembered ${result.preference.description} for ${result.preference.ingredientName}.`);
    } catch (err) {
      setStoreItemReviewMessage(err instanceof Error ? err.message : "Unable to remember the store item selection.");
    }
  }

  async function updateStoreItemQuantity(shoppingItemId: number, cartQuantity: number) {
    if (!storeItemReview) return;
    setStoreItemReviewMessage("");
    try {
      const result = await api<{ match: StoreItemMatch }>(
        `/api/store-item-reviews/${storeItemReview.jobId}/quantities/${shoppingItemId}`,
        {
          method: "PUT",
          body: JSON.stringify({ cartQuantity })
        }
      );
      setStoreItemReview((current) => current ? {
        ...current,
        result: {
          ...current.result,
          matched: current.result.matched?.map((match) =>
            match.item.id === shoppingItemId ? result.match : match
          )
        }
      } : current);
    } catch (err) {
      setStoreItemReviewMessage(err instanceof Error ? err.message : "Unable to update the cart quantity.");
      throw err;
    }
  }

  async function searchStoreItemsForReview(shoppingItemId: number, term: string) {
    if (!storeItemReview) {
      throw new Error("Preview store items before searching for more choices.");
    }

    const result = await api<StoreItemReviewSearchResult>(
      `/api/store-item-reviews/${storeItemReview.jobId}/items/${shoppingItemId}/search`,
      {
        method: "POST",
        body: JSON.stringify({ term })
      }
    );
    setStoreItemReview((current) => current ? {
      ...current,
      result: {
        ...current.result,
        items: result.items,
        matched: result.matched,
        skipped: result.skipped
      }
    } : current);
    return result;
  }

  async function removeStoreItemFromReview(item: ShoppingListItem) {
    if (!storeItemReview) {
      setStoreItemReviewMessage("Preview store items before removing an ingredient.");
      return false;
    }

    setStoreItemReviewMessage("");
    try {
      const result = await api<StoreItemReviewRemoval>(
        `/api/store-item-reviews/${storeItemReview.jobId}/items/${item.id}`,
        { method: "DELETE" }
      );
      setStoreItemReview((current) => current ? {
        ...current,
        result: {
          ...current.result,
          items: result.items,
          matched: result.matched,
          skipped: result.skipped
        }
      } : current);
      setStoreItemReviewMessage(`Removed ${item.item || item.text} from this review.`);
      return true;
    } catch (err) {
      setStoreItemReviewMessage(err instanceof Error ? err.message : "Unable to remove the ingredient from this review.");
      return false;
    }
  }

  async function forgetStoreItemPreference(provider: string, ingredientKey: string) {
    await api(`/api/store-item-preferences/${encodeURIComponent(provider)}/${encodeURIComponent(ingredientKey)}`, { method: "DELETE" });
    setStoreItemPreferences((current) => current.filter((preference) =>
      preference.provider !== provider || preference.ingredientKey !== ingredientKey
    ));
    setStoreItemReview(null);
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="icon-button menu-trigger"
              onClick={() => setIsMenuOpen((open) => !open)}
              aria-expanded={isMenuOpen}
              aria-label={isMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            >
              {isMenuOpen ? <X size={20} /> : <MenuIcon size={20} />}
            </button>
            <div>
              <h1>
                <a
                  className="app-title-link"
                  href="/planner"
                  onClick={(event) => {
                    if (event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
                      event.preventDefault();
                      selectView("planner");
                    }
                  }}
                >
                  Grocery Getter
                </a>
              </h1>
              <span className="eyebrow">{currentView.eyebrow}</span>
              <h2>{currentView.title}</h2>
            </div>
          </div>
          <div className="topbar-actions">
            <div className="topbar-button-row">
              <button
                className="icon-button"
                onClick={() => setThemeMode((mode) => (mode === "dark" ? "light" : "dark"))}
                aria-label={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                aria-pressed={themeMode === "dark"}
                title={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                type="button"
              >
                {themeMode === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <button
                className="icon-button"
                onClick={() => void Promise.all([loadRecipes(), loadCustomShoppingLists()])}
                aria-label="Refresh data"
                type="button"
              >
                <RefreshCw size={18} />
              </button>
            </div>
            <label className="data-scope-control">
              <span>Data</span>
              <select
                value={dataScope}
                onChange={(event) => updateDataScope(event.target.value as DataScope)}
                aria-label="Data mode"
              >
                <option value="production">Production</option>
                <option value="sandbox">Sandbox</option>
              </select>
            </label>
          </div>
        </header>

        {dataScope === "sandbox" ? (
          <div className="sandbox-banner" role="status">
            Sandbox mode: recipes, menus, shopping lists, and store preferences are isolated.
          </div>
        ) : null}

        {isMenuOpen ? (
          <div className="menu-panel">
            <nav className="view-tabs" aria-label="Primary navigation">
              {views.map((view) => {
                const Icon = view.icon;
                return (
                  <button
                    className={view.id === activeView ? "tab-button active" : "tab-button"}
                    key={view.id}
                    onClick={() => selectView(view.id)}
                  >
                    <Icon size={18} />
                    {view.label}
                  </button>
                );
              })}
            </nav>
          </div>
        ) : null}

        {activeView === "recipe-admin" ? (
          <RecipesPage
            api={api}
            activeTab={activeRoute.recipeAdminTab ?? "manage"}
            editingRecipeId={activeRoute.recipeId ?? null}
            onEdit={(recipeId) => navigate(recipeEditRoute(recipeId))}
            onExitEdit={() => navigate(routeFromPathname("/recipes/manage"))}
            onTabChange={(tab) => navigate(routeFromPathname(`/recipes/${tab}`))}
            recipes={recipes}
            recipeCounts={recipeCounts}
            onSaved={loadRecipes}
          />
        ) : null}

        {activeView === "shopping-lists" ? (
          <ShoppingListsPage
            api={api}
            activeTab={activeRoute.shoppingListsTab ?? "manage"}
            editingListId={activeRoute.shoppingListId ?? null}
            lists={customShoppingLists}
            onEdit={(listId) => navigate(shoppingListEditRoute(listId))}
            onExitEdit={() => navigate(routeFromPathname("/shopping-lists/manage"))}
            onTabChange={(tab) => navigate(routeFromPathname(`/shopping-lists/${tab}`))}
            onSaved={loadCustomShoppingLists}
          />
        ) : null}

        {activeView === "qfc-api" ? (
          <StoreSettingsPanel
            api={api}
            activeTab={activeRoute.qfcSettingsTab ?? "api"}
            onTabChange={(tab) => navigate(routeFromPathname(`/settings/qfc/${tab}`))}
            status={qfcStatus}
            dataScope={dataScope}
            reloadStatus={loadSettings}
            preferStoreBrands={preferStoreBrands}
            updateStoreBrandPreference={updateStoreBrandPreference}
            allowRealQfcCartMutation={allowRealQfcCartMutation}
            updateRealQfcCartPermission={updateRealQfcCartPermission}
            storeItemPreferences={storeItemPreferences}
            forgetStoreItemPreference={forgetStoreItemPreference}
          />
        ) : null}

        {activeView === "planner" ? (
          <div className="grid planner-grid">
          <MenuBuilder
            recipes={recipes}
            customShoppingLists={customShoppingLists}
            mealCount={mealCount}
            setMealCount={setMealCount}
            activeMenu={activeMenu}
            generateMenu={generateMenu}
            saveMenu={saveMenu}
            updateMenuItem={updateMenuItem}
            editRecipe={(recipeId) => navigate(recipeEditRoute(recipeId))}
            addMeal={addMeal}
            removeMeal={removeMeal}
            updateCustomShoppingListSelection={updateCustomShoppingListSelection}
            editCustomShoppingList={(listId) => navigate(shoppingListEditRoute(listId))}
            aggregateIngredients={aggregateIngredients}
          />
            <ShoppingListReview
              items={shoppingList}
              openSource={(source) => navigate(
                source.type === "recipe"
                  ? recipeEditRoute(source.id)
                  : shoppingListEditRoute(source.id)
              )}
              savingApprovalItemIds={savingApprovalItemIds}
              searchingStoreItemIds={searchingStoreItemIds}
              savingSourceItemIds={savingSourceItemIds}
              updateApproval={updateShoppingItemApproval}
              saveToSource={saveShoppingItemToSource}
              clearItems={clearAggregatedIngredients}
              previewStoreItems={previewStoreItems}
              qfcSubmitProgress={qfcSubmitProgress}
              message={message}
            />
            <StoreItemReviewPanel
              review={storeItemReview}
              allowRealQfcCartMutation={allowRealQfcCartMutation}
              addToCart={addReviewedStoreItemsToQfc}
              selectStoreItem={selectStoreItem}
              updateCartQuantity={updateStoreItemQuantity}
              searchStoreItems={searchStoreItemsForReview}
              removeStoreItem={removeStoreItemFromReview}
              openSource={(source) => navigate(
                source.type === "recipe"
                  ? recipeEditRoute(source.id)
                  : shoppingListEditRoute(source.id)
              )}
              openQfcCart={openQfcCart}
              qfcSubmitProgress={qfcSubmitProgress}
              message={storeItemReviewMessage}
            />
          </div>
        ) : null}
      </section>
    </main>
  );
}

function StoreSettingsPanel({
  api,
  activeTab,
  onTabChange,
  status,
  dataScope,
  reloadStatus,
  preferStoreBrands,
  updateStoreBrandPreference,
  allowRealQfcCartMutation,
  updateRealQfcCartPermission,
  storeItemPreferences,
  forgetStoreItemPreference
}: {
  api: ApiRequest;
  activeTab: QfcSettingsTab;
  onTabChange: (tab: QfcSettingsTab) => void;
  status: QfcStatus | null;
  dataScope: DataScope;
  reloadStatus: () => Promise<void>;
  preferStoreBrands: boolean;
  updateStoreBrandPreference: (next: boolean) => Promise<void>;
  allowRealQfcCartMutation: boolean;
  updateRealQfcCartPermission: (next: boolean) => Promise<void>;
  storeItemPreferences: StoreItemPreference[];
  forgetStoreItemPreference: (provider: string, ingredientKey: string) => Promise<void>;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [locationId, setLocationId] = useState("");
  const [serviceScopes, setServiceScopes] = useState("product.compact");
  const [customerScopes, setCustomerScopes] = useState("cart.basic:write");
  const [redirectUri, setRedirectUri] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [locations, setLocations] = useState<QfcLocation[]>([]);
  const [storeItemTerm, setStoreItemTerm] = useState("");
  const [storeItems, setStoreItems] = useState<StoreItemCandidate[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!status) return;
    setClientId(status.clientId);
    setLocationId(status.locationId);
    setServiceScopes(status.serviceScopes);
    setCustomerScopes(status.customerScopes);
    setRedirectUri(isLoopbackHost(window.location.hostname) ? status.redirectUri : browserQfcCallbackUri());
  }, [status]);

  async function saveSettings() {
    setError("");
    try {
      await api("/api/qfc/settings", {
        method: "PUT",
        body: JSON.stringify(dataScope === "sandbox"
          ? { locationId }
          : {
            clientId: clientId.trim() || undefined,
            clientSecret: clientSecret.trim() || undefined,
            locationId,
            serviceScopes,
            customerScopes,
            redirectUri
          })
      });
      setClientId(clientId.trim());
      setLocationId(locationId.trim());
      setClientSecret("");
      await reloadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save QFC settings.");
    }
  }

  async function startCustomerOAuth() {
    setError("");
    try {
      const nextRedirectUri = isLoopbackHost(window.location.hostname)
        ? redirectUri.trim()
        : browserQfcCallbackUri();
      if (nextRedirectUri && nextRedirectUri !== status?.redirectUri) {
        await api("/api/qfc/settings", {
          method: "PUT",
          body: JSON.stringify({ redirectUri: nextRedirectUri })
        });
        setRedirectUri(nextRedirectUri);
      }
      const result = await api<{ authorizationUrl: string }>("/api/qfc/oauth/start", { method: "POST" });
      window.open(result.authorizationUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start customer OAuth.");
    }
  }

  async function refreshCustomerOAuth() {
    setError("");
    try {
      await api("/api/qfc/oauth/refresh", { method: "POST" });
      await reloadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to refresh customer OAuth.");
    }
  }

  async function findLocations() {
    setError("");
    try {
      setLocations(await api<QfcLocation[]>(`/api/qfc/locations?query=${encodeURIComponent(locationQuery)}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to search locations.");
    }
  }

  async function findStoreItems() {
    setError("");
    try {
      const params = new URLSearchParams({ term: storeItemTerm });
      const trimmedLocationId = locationId.trim();
      if (trimmedLocationId) {
        params.set("locationId", trimmedLocationId);
        await saveLocationId(trimmedLocationId);
      }
      setStoreItems(await api<StoreItemCandidate[]>(`/api/qfc/store-items?${params.toString()}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to search store items.");
    }
  }

  async function saveLocationId(nextLocationId: string) {
    await api("/api/qfc/settings", {
      method: "PUT",
      body: JSON.stringify({ locationId: nextLocationId })
    });
    setLocationId(nextLocationId);
    await reloadStatus();
  }

  return (
    <section className="panel full-width">
      <div className="panel-heading">
        <Settings size={18} />
        <h3>QFC Settings</h3>
      </div>

      <div className="sub-tabs" role="tablist" aria-label="QFC settings sections">
        <button
          className={`sub-tab-button ${activeTab === "api" ? "active" : ""}`}
          onClick={() => onTabChange("api")}
          role="tab"
          aria-selected={activeTab === "api"}
          type="button"
        >
          QFC API Setup
        </button>
        <button
          className={`sub-tab-button ${activeTab === "preferences" ? "active" : ""}`}
          onClick={() => onTabChange("preferences")}
          role="tab"
          aria-selected={activeTab === "preferences"}
          type="button"
        >
          Store Item Preferences
        </button>
      </div>

      {activeTab === "api" ? (
        <div className="tab-panel" role="tabpanel">
          {dataScope === "sandbox" ? (
            <div className="sandbox-notice">
              Sandbox uses the real QFC catalog and shared connection. Credentials and OAuth can only be changed in production.
            </div>
          ) : null}
          <div className="status-strip">
            <span className={status?.hasClientId ? "status-good" : "status-muted"}>Client ID</span>
            <span className={status?.hasClientSecret ? "status-good" : "status-muted"}>Client secret</span>
            <span className={status?.locationId ? "status-good" : "status-muted"}>Location</span>
            <span className={status?.hasCustomerAccessToken ? "status-good" : "status-muted"}>Customer OAuth</span>
            <span className={status?.hasCustomerRefreshToken ? "status-good" : "status-muted"}>Refresh token</span>
          </div>

          <div className="qfc-grid">
            <label>
              Client ID
              <input value={clientId} onChange={(event) => setClientId(event.target.value)} disabled={dataScope === "sandbox"} />
            </label>
            <label>
              Client secret
              <input
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                placeholder={status?.hasClientSecret ? "Already saved" : ""}
                type="password"
                disabled={dataScope === "sandbox"}
              />
            </label>
            <label>
              Location ID
              <input value={locationId} onChange={(event) => setLocationId(event.target.value)} />
            </label>
            <label>
              Service scopes
              <input value={serviceScopes} onChange={(event) => setServiceScopes(event.target.value)} disabled={dataScope === "sandbox"} />
            </label>
            <label>
              Customer scopes
              <input value={customerScopes} onChange={(event) => setCustomerScopes(event.target.value)} disabled={dataScope === "sandbox"} />
            </label>
            <label className="wide-field">
              Redirect URI
              <input value={redirectUri} onChange={(event) => setRedirectUri(event.target.value)} disabled={dataScope === "sandbox"} />
            </label>
          </div>

          <div className="panel-actions">
            <button className="secondary" onClick={() => void reloadStatus()}>
              <RefreshCw size={17} />
              Refresh status
            </button>
            <button className="secondary" onClick={() => void refreshCustomerOAuth()} disabled={dataScope === "sandbox"}>
              <RefreshCw size={17} />
              Refresh OAuth
            </button>
            <button onClick={() => void startCustomerOAuth()} disabled={dataScope === "sandbox"}>
              <Send size={17} />
              Start customer OAuth
            </button>
            <button onClick={() => void saveSettings()}>
              <Check size={17} />
              {dataScope === "sandbox" ? "Save sandbox location" : "Save QFC settings"}
            </button>
          </div>

          <div className="qfc-tools">
            <div>
              <div className="tool-row">
                <input value={locationQuery} onChange={(event) => setLocationQuery(event.target.value)} placeholder="Search locations by ZIP" />
                <button className="secondary" onClick={() => void findLocations()}>Find locations</button>
              </div>
              <div className="result-list">
                {locations.map((location) => (
                  <button
                    className="result-row"
                    key={location.locationId}
                    onClick={() => void saveLocationId(location.locationId)}
                  >
                    <strong>{location.name}</strong>
                    <span>{location.locationId}</span>
                    <span>{[location.address?.addressLine1, location.address?.city, location.address?.state].filter(Boolean).join(", ")}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="tool-row">
                <input value={storeItemTerm} onChange={(event) => setStoreItemTerm(event.target.value)} placeholder="Search store items" />
                <button className="secondary" onClick={() => void findStoreItems()}>Find store items</button>
              </div>
              <div className="result-list">
                {storeItems.map((storeItem) => (
                  <div className="store-item-row" key={`${storeItem.productId}-${storeItem.upc}`}>
                    <strong>{storeItem.description}</strong>
                    <span>{[storeItem.brand, storeItem.size, storeItem.stockLevel].filter(Boolean).join(" / ")}</span>
                    <span>{storeItem.price === null ? "" : `$${storeItem.price.toFixed(2)}`}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {error ? <div className="error">{error}</div> : null}
        </div>
      ) : (
        <div className="tab-panel" role="tabpanel">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={preferStoreBrands}
              onChange={(event) => void updateStoreBrandPreference(event.target.checked)}
            />
            <span>Prefer store brands when an ingredient has no remembered store item</span>
          </label>
          <label className={`toggle-row ${dataScope === "sandbox" ? "sandbox-cart-toggle" : ""}`}>
            <input
              type="checkbox"
              checked={allowRealQfcCartMutation}
              onChange={(event) => void updateRealQfcCartPermission(event.target.checked)}
            />
            <span>
              Allow this {dataScope} mode to add reviewed items to the real QFC cart
            </span>
          </label>
          <div className="store-item-preference-section">
            <div>
              <h4>Remembered store items</h4>
              <p>Selections made during store item review are reused whenever the same ingredient appears again.</p>
            </div>
            {storeItemPreferences.length ? (
              <div className="store-item-preference-list">
                {storeItemPreferences.map((preference) => (
                  <div className="store-item-preference-row" key={preference.ingredientKey}>
                    <div>
                      <strong>{preference.ingredientName}</strong>
                      <span>{preference.description}</span>
                      <span>{[preference.brand, preference.size].filter(Boolean).join(" · ")}</span>
                    </div>
                    <button
                      className="secondary"
                      onClick={() => void forgetStoreItemPreference(preference.provider, preference.ingredientKey)}
                      type="button"
                    >
                      Forget
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">No store item choices have been remembered yet.</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function StoreItemReviewPanel({
  review,
  allowRealQfcCartMutation,
  addToCart,
  selectStoreItem,
  updateCartQuantity,
  searchStoreItems,
  removeStoreItem,
  openSource,
  openQfcCart,
  qfcSubmitProgress,
  message
}: {
  review: StoreItemReview | null;
  allowRealQfcCartMutation: boolean;
  addToCart: () => Promise<void>;
  selectStoreItem: (shoppingItemId: number, productId: string, upc: string) => Promise<void>;
  updateCartQuantity: (shoppingItemId: number, cartQuantity: number) => Promise<void>;
  searchStoreItems: (
    shoppingItemId: number,
    term: string
  ) => Promise<{
    match: StoreItemMatch | null;
    matched: StoreItemMatch[];
    skipped: QfcCartSkip[];
    resultCount: number;
  }>;
  removeStoreItem: (item: ShoppingListItem) => Promise<boolean>;
  openSource: (source: ShoppingListSourceTarget) => void;
  openQfcCart: () => void;
  qfcSubmitProgress: QfcSubmitProgress | null;
  message: string;
}) {
  const [selectingItemId, setSelectingItemId] = useState<number | null>(null);
  const [updatingQuantityItemId, setUpdatingQuantityItemId] = useState<number | null>(null);
  const [quantityDrafts, setQuantityDrafts] = useState<Record<number, string>>({});
  const [findingItemId, setFindingItemId] = useState<number | null>(null);
  const [searchingItemId, setSearchingItemId] = useState<number | null>(null);
  const [removingItemId, setRemovingItemId] = useState<number | null>(null);
  const [customSearchTerm, setCustomSearchTerm] = useState("");
  const [customSearchFeedback, setCustomSearchFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const matches = review?.result.matched ?? [];
  const skipped = review?.result.skipped ?? [];

  useEffect(() => {
    setFindingItemId(null);
    setUpdatingQuantityItemId(null);
    setQuantityDrafts({});
    setSearchingItemId(null);
    setRemovingItemId(null);
    setCustomSearchTerm("");
    setCustomSearchFeedback(null);
  }, [review?.jobId]);

  async function updateSelection(match: StoreItemMatch, selection: string) {
    const [productId, upc] = JSON.parse(selection) as [string, string];
    await rememberSelection(match, productId, upc);
  }

  async function rememberSelection(match: StoreItemMatch, productId: string, upc: string) {
    setSelectingItemId(match.item.id);
    try {
      await selectStoreItem(match.item.id, productId, upc);
    } finally {
      setSelectingItemId(null);
    }
  }

  async function updateQuantity(match: StoreItemMatch, value: string) {
    setQuantityDrafts((current) => ({ ...current, [match.item.id]: value }));
    const cartQuantity = Number(value);
    if (!Number.isInteger(cartQuantity) || cartQuantity < 1 || cartQuantity === match.cartQuantity) return;
    setUpdatingQuantityItemId(match.item.id);
    try {
      await updateCartQuantity(match.item.id, cartQuantity);
      setQuantityDrafts((current) => ({ ...current, [match.item.id]: String(cartQuantity) }));
    } catch {
      setQuantityDrafts((current) => ({ ...current, [match.item.id]: String(match.cartQuantity) }));
    } finally {
      setUpdatingQuantityItemId(null);
    }
  }

  function restoreQuantityIfInvalid(match: StoreItemMatch) {
    const draft = quantityDrafts[match.item.id];
    const cartQuantity = Number(draft);
    if (draft === undefined || (Number.isInteger(cartQuantity) && cartQuantity >= 1)) return;
    setQuantityDrafts((current) => ({ ...current, [match.item.id]: String(match.cartQuantity) }));
  }

  function adjustedQuantity(match: StoreItemMatch, change: number) {
    const draftQuantity = Number(quantityDrafts[match.item.id]);
    const currentQuantity = Number.isInteger(draftQuantity) && draftQuantity >= 1
      ? draftQuantity
      : match.cartQuantity;
    return Math.max(1, currentQuantity + change);
  }

  async function removeReviewItem(item: ShoppingListItem) {
    setRemovingItemId(item.id);
    try {
      const removed = await removeStoreItem(item);
      if (removed && findingItemId === item.id) {
        setFindingItemId(null);
        setCustomSearchTerm("");
        setCustomSearchFeedback(null);
      }
    } finally {
      setRemovingItemId(null);
    }
  }

  function renderRemoveButton(item: ShoppingListItem) {
    const itemName = item.item || item.text;

    return (
      <button
        className="icon-button danger store-item-remove-button"
        type="button"
        aria-label={`Remove ${itemName} from review`}
        aria-busy={removingItemId === item.id}
        disabled={removingItemId === item.id}
        onClick={() => void removeReviewItem(item)}
      >
        <Trash2 size={16} />
      </button>
    );
  }

  function renderSourceLinks(item: ShoppingListItem) {
    if (!item.sourceTargets?.length) {
      return <span>{item.sourceNames}</span>;
    }

    return (
      <span className="shopping-source-links">
        {item.sourceTargets.map((source, index) => (
          <React.Fragment key={`${source.type}-${source.id}`}>
            {index ? ", " : null}
            <a
              href={
                source.type === "recipe"
                  ? recipeEditRoute(source.id).path
                  : shoppingListEditRoute(source.id).path
              }
              onClick={(event) => {
                if (
                  event.button === 0
                  && !event.altKey
                  && !event.ctrlKey
                  && !event.metaKey
                  && !event.shiftKey
                ) {
                  event.preventDefault();
                  openSource(source);
                }
              }}
            >
              {source.name}
            </a>
          </React.Fragment>
        ))}
      </span>
    );
  }

  function showCustomSearch(item: ShoppingListItem) {
    setFindingItemId(item.id);
    setCustomSearchTerm(item.item || item.text);
    setCustomSearchFeedback(null);
  }

  async function runCustomSearch(event: React.FormEvent, item: ShoppingListItem) {
    event.preventDefault();
    const term = customSearchTerm.trim();
    if (!term) {
      setCustomSearchFeedback({ type: "error", text: "Enter a search term." });
      return;
    }

    const wasUnmatched = skipped.some((skip) => skip.item.id === item.id);
    setSearchingItemId(item.id);
    setCustomSearchFeedback(null);
    try {
      const result = await searchStoreItems(item.id, term);
      if (!result.resultCount) {
        setCustomSearchFeedback({ type: "error", text: `No store items found for “${term}”.` });
      } else {
        setCustomSearchFeedback({
          type: "success",
          text: wasUnmatched
            ? `${result.resultCount} store item${result.resultCount === 1 ? "" : "s"} found. The ingredient is now matched.`
            : `Dropdown replaced with ${result.resultCount} store item${result.resultCount === 1 ? "" : "s"}.`
        });
      }
    } catch (err) {
      setCustomSearchFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Unable to search store items."
      });
    } finally {
      setSearchingItemId(null);
    }
  }

  function renderFindItemControl(item: ShoppingListItem) {
    if (findingItemId !== item.id) {
      return (
        <button
          className="secondary store-item-find-button"
          type="button"
          onClick={() => showCustomSearch(item)}
        >
          <Search size={16} />
          Find item
        </button>
      );
    }

    return (
      <form className="store-item-custom-search" onSubmit={(event) => void runCustomSearch(event, item)}>
        <label>
          <span className="eyebrow">Custom store item search</span>
          <input
            value={customSearchTerm}
            onChange={(event) => setCustomSearchTerm(event.target.value)}
            placeholder="Enter a different search term"
            autoFocus
          />
        </label>
        <div className="store-item-custom-search-actions">
          <button
            type="submit"
            aria-busy={searchingItemId === item.id}
            disabled={!customSearchTerm.trim() || searchingItemId === item.id}
          >
            <Search size={16} />
            {searchingItemId === item.id ? "Searching..." : "Search"}
          </button>
          <button
            className="secondary"
            type="button"
            onClick={() => {
              setFindingItemId(null);
              setCustomSearchFeedback(null);
            }}
          >
            Cancel
          </button>
        </div>
        {customSearchFeedback ? (
          <span
            className={`store-item-search-feedback ${customSearchFeedback.type}`}
            role="status"
          >
            {customSearchFeedback.text}
          </span>
        ) : null}
      </form>
    );
  }

  return (
    <section className="panel full-width">
      <div className="panel-heading">
        <Send size={18} />
        <h3>Store Item Review</h3>
      </div>

      {review ? (
        <>
          {matches.length ? (
            <div className="store-item-match-list">
              {matches.map((match) => (
                <div className="store-item-match-row" key={match.item.id}>
                  <div className="store-item-match-ingredient">
                    <span className="eyebrow">Aggregated ingredient</span>
                    <strong>{match.item.text || [match.item.quantity, match.item.unit, match.item.item].filter(Boolean).join(" ")}</strong>
                    {renderSourceLinks(match.item)}
                  </div>
                  <ChevronRight className="store-item-match-arrow" size={22} aria-hidden="true" />
                  <div className="store-item-match-selection">
                    <span className="eyebrow">
                      {match.selectionSource === "remembered"
                        ? "Remembered store item"
                        : match.selectionSource === "search"
                          ? "Selected from custom search"
                          : "Selected by general preferences"}
                    </span>
                    <select
                      aria-label={`Store item for ${match.item.item || match.item.text}`}
                      disabled={selectingItemId === match.item.id}
                      value={JSON.stringify([match.storeItem.productId, match.storeItem.upc])}
                      onChange={(event) => void updateSelection(match, event.target.value)}
                    >
                      {match.candidates.map((candidate) => (
                        <option
                          key={`${candidate.productId}-${candidate.upc}`}
                          value={JSON.stringify([candidate.productId, candidate.upc])}
                        >
                          {[candidate.description, candidate.brand, candidate.size].filter(Boolean).join(" — ")}
                        </option>
                      ))}
                    </select>
                    <div className="store-item-selection-actions">
                      {renderFindItemControl(match.item)}
                      {findingItemId !== match.item.id ? (
                        <button
                          className="secondary icon-button store-item-remember-button"
                          type="button"
                          aria-label={`Remember selected store item for ${match.item.item || match.item.text}`}
                          title={
                            match.selectionSource === "remembered"
                              ? "This store item is already remembered"
                              : "Remember the selected store item"
                          }
                          aria-busy={selectingItemId === match.item.id}
                          disabled={
                            selectingItemId === match.item.id
                            || match.selectionSource === "remembered"
                          }
                          onClick={() => void rememberSelection(
                            match,
                            match.storeItem.productId,
                            match.storeItem.upc
                          )}
                        >
                          <BookmarkPlus size={17} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                    <div className="store-item-quantity">
                      <span className="eyebrow">Cart quantity</span>
                      <div className="store-item-number-control">
                        <button
                          type="button"
                          aria-label={`Decrease cart quantity for ${match.storeItem.description}`}
                          aria-busy={updatingQuantityItemId === match.item.id}
                          disabled={updatingQuantityItemId === match.item.id || adjustedQuantity(match, 0) <= 1}
                          onClick={() => void updateQuantity(match, String(adjustedQuantity(match, -1)))}
                        >
                          <Minus size={18} />
                        </button>
                        <input
                          aria-label={`Cart quantity for ${match.storeItem.description}`}
                          type="number"
                          inputMode="numeric"
                          min="1"
                          step="1"
                          value={quantityDrafts[match.item.id] ?? String(match.cartQuantity)}
                          disabled={updatingQuantityItemId === match.item.id}
                          onChange={(event) => void updateQuantity(match, event.target.value)}
                          onBlur={() => restoreQuantityIfInvalid(match)}
                        />
                        <button
                          type="button"
                          aria-label={`Increase cart quantity for ${match.storeItem.description}`}
                          aria-busy={updatingQuantityItemId === match.item.id}
                          disabled={updatingQuantityItemId === match.item.id}
                          onClick={() => void updateQuantity(match, String(adjustedQuantity(match, 1)))}
                        >
                          <Plus size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="store-item-selected-details">
                    {match.storeItem.imageUrl ? (
                      <img
                        className="store-item-thumbnail"
                        src={match.storeItem.imageUrl}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <div className="store-item-thumbnail placeholder" aria-hidden="true">
                        <Package size={28} />
                      </div>
                    )}
                    <div>
                      <strong>{match.storeItem.description}</strong>
                      <span>{[match.storeItem.brand, match.storeItem.size].filter(Boolean).join(" · ") || "Package details unavailable"}</span>
                      <span>
                        {match.storeItem.price === null ? "Price unavailable" : `$${match.storeItem.price.toFixed(2)}`}
                        {match.storeItem.stockLevel ? ` · Stock: ${match.storeItem.stockLevel.replaceAll("_", " ").toLowerCase()}` : ""}
                        {` · Qty ${match.cartQuantity}`}
                      </span>
                    </div>
                  </div>
                  {renderRemoveButton(match.item)}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">No store items were matched.</div>
          )}

          {skipped.length ? (
            <div className="store-item-unmatched">
              <h4>Unmatched ingredients</h4>
              {skipped.map((skip) => (
                <div className="store-item-unmatched-row" key={skip.item.id}>
                  <div>
                    <strong>{skip.item.text || skip.item.item}</strong>
                    {renderSourceLinks(skip.item)}
                    <span>{skip.reason}</span>
                  </div>
                  <div className="store-item-unmatched-actions">
                    {renderFindItemControl(skip.item)}
                  </div>
                  {renderRemoveButton(skip.item)}
                </div>
              ))}
            </div>
          ) : null}

          <div className="panel-actions store-item-review-actions">
            <button
              aria-busy={qfcSubmitProgress?.phase === "adding"}
              onClick={() => void addToCart()}
              disabled={
                !allowRealQfcCartMutation
                || !matches.length
                || Boolean(qfcSubmitProgress)
                || updatingQuantityItemId !== null
              }
              title={allowRealQfcCartMutation ? undefined : "Enable real cart changes in QFC preferences"}
            >
              <Send size={17} />
              {qfcSubmitProgress?.phase === "adding"
                ? "Adding to QFC..."
                : allowRealQfcCartMutation
                  ? `Add ${matches.length} reviewed store item${matches.length === 1 ? "" : "s"} to QFC`
                  : "Real QFC cart changes disabled"}
            </button>
            <button className="secondary" onClick={openQfcCart}>
              <ExternalLink size={17} />
              Open cart on QFC
            </button>
          </div>
          {qfcSubmitProgress?.phase === "adding" ? <QfcSubmitProgressBar progress={qfcSubmitProgress} /> : null}
          {message ? <div className="success" role="status">{message}</div> : null}
        </>
      ) : (
        <div className="empty-state">Review and approve ingredients, then match them to store items.</div>
      )}
    </section>
  );
}
