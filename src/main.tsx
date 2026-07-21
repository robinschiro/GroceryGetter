import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Database,
  ExternalLink,
  ListChecks,
  Menu as MenuIcon,
  Minus,
  Moon,
  Package,
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
import "./styles.css";

type RecipeCategory = "entree" | "vegetable_side" | "starch_side";
type DataScope = "production" | "sandbox";

type Recipe = {
  id: number;
  name: string;
  category: RecipeCategory;
  includeInMenuGeneration: boolean;
  dataScope: DataScope;
  servings: number | null;
  notes: string;
  ingredients: RecipeIngredient[];
};

type RecipeAdminTab = "create" | "manage";
type ShoppingListsTab = "create" | "manage";
type QfcSettingsTab = "api" | "preferences";
type ThemeMode = "light" | "dark";
type RecipeCategoryCount = (typeof categories)[number] & { count: number };

type RecipeIngredient = {
  id?: number;
  text: string;
  quantity: string;
  unit: string;
  item: string;
};

type Menu = {
  id: number | null;
  name: string;
  mealCount: number;
  dataScope: DataScope;
  status: string;
  items: MenuItem[];
  customShoppingListIds: number[];
};

type MenuItem = {
  id: number | null;
  mealNumber: number;
  slot: RecipeCategory;
  recipeId: number | null;
  recipeName: string | null;
};

type ShoppingListItem = {
  id: number;
  text: string;
  quantity: string;
  unit: string;
  item: string;
  sourceNames: string;
  approved: number;
  sourceOccurrenceCount: number;
  canPersistToSource: number;
  sourceTargets: ShoppingListSourceTarget[];
};

type ShoppingListSourceTarget = {
  type: "recipe" | "shoppingList";
  id: number;
  name: string;
};

type CustomShoppingListItem = {
  id?: number;
  customShoppingListId?: number;
  text: string;
  quantity: string;
  unit: string;
  item: string;
  sortOrder?: number;
};

type CustomShoppingList = {
  id: number;
  name: string;
  dataScope: DataScope;
  includeInMenuByDefault: boolean;
  items: CustomShoppingListItem[];
};

type QfcStatus = {
  clientId: string;
  hasClientId: boolean;
  hasClientSecret: boolean;
  locationId: string;
  hasCustomerAccessToken: boolean;
  hasCustomerRefreshToken: boolean;
  customerTokenExpiresAt: number;
  customerTokenExpired: boolean;
  redirectUri: string;
  serviceScopes: string;
  customerScopes: string;
};

type QfcLocation = {
  locationId: string;
  name: string;
  chain?: string;
  address?: {
    addressLine1?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
};

type StoreItemCandidate = {
  productId: string;
  upc: string;
  description: string;
  brand: string;
  size: string;
  stockLevel: string;
  price: number | null;
  imageUrl: string;
  isStoreBrand: boolean;
};

type QfcSubmitProgress = {
  phase: "checking" | "matching" | "adding" | "complete";
  processedItems: number;
  totalItems: number;
  message: string;
};

type QfcSubmitJob = {
  id: string;
  status: "running" | "complete" | "failed";
  progress: QfcSubmitProgress;
  result?: {
    mode: "stub" | "api";
    submittedItemCount: number;
    message: string;
    items: ShoppingListItem[];
    matched?: StoreItemMatch[];
    skipped?: QfcCartSkip[];
  };
  error?: string;
};

type StoreItemMatch = {
  item: ShoppingListItem;
  storeItem: StoreItemCandidate;
  candidates: StoreItemCandidate[];
  selectionSource: "remembered" | "general" | "search";
  cartQuantity: number;
};

type QfcCartSkip = {
  item: ShoppingListItem;
  reason: string;
};

type StoreItemReview = {
  jobId: string;
  result: NonNullable<QfcSubmitJob["result"]>;
};

type StoreItemPreference = {
  ingredientKey: string;
  ingredientName: string;
  provider: string;
  storeItemId: string;
  upc: string;
  description: string;
  brand: string;
  size: string;
  imageUrl: string;
  isStoreBrand: boolean;
  updatedAt: string;
};

type AppView = "recipe-admin" | "shopping-lists" | "qfc-api" | "planner";

type AppRoute = {
  path: string;
  view: AppView;
  recipeAdminTab?: RecipeAdminTab;
  recipeId?: number;
  shoppingListsTab?: ShoppingListsTab;
  shoppingListId?: number;
  qfcSettingsTab?: QfcSettingsTab;
};

const categories: Array<{ value: RecipeCategory; label: string }> = [
  { value: "entree", label: "Entree" },
  { value: "vegetable_side", label: "Vegetable side" },
  { value: "starch_side", label: "Starch side" }
];
const recipeManagementPageSize = 50;

const emptyIngredient = (): RecipeIngredient => ({
  text: "",
  quantity: "",
  unit: "",
  item: ""
});

function normalizeRecipeIngredient(ingredient: RecipeIngredient): RecipeIngredient | null {
  const quantity = ingredient.quantity.trim();
  const unit = ingredient.unit.trim();
  const item = ingredient.item.trim();
  const text = ingredient.text.trim() || [quantity, unit, item].filter(Boolean).join(" ");

  if (!item) {
    return null;
  }

  return {
    ...ingredient,
    text,
    quantity,
    unit,
    item
  };
}

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

const appRoutes: AppRoute[] = [
  { path: "/planner", view: "planner" },
  { path: "/recipes/manage", view: "recipe-admin", recipeAdminTab: "manage" },
  { path: "/recipes/create", view: "recipe-admin", recipeAdminTab: "create" },
  { path: "/shopping-lists/manage", view: "shopping-lists", shoppingListsTab: "manage" },
  { path: "/shopping-lists/create", view: "shopping-lists", shoppingListsTab: "create" },
  { path: "/settings/qfc/api", view: "qfc-api", qfcSettingsTab: "api" },
  { path: "/settings/qfc/preferences", view: "qfc-api", qfcSettingsTab: "preferences" }
];

function normalizePathname(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function routeFromPathname(pathname: string) {
  const normalizedPathname = normalizePathname(pathname);
  const recipeEditMatch = /^\/recipes\/manage\/([1-9]\d*)$/.exec(normalizedPathname);
  if (recipeEditMatch) {
    return recipeEditRoute(Number(recipeEditMatch[1]));
  }
  const shoppingListEditMatch = /^\/shopping-lists\/manage\/([1-9]\d*)$/.exec(normalizedPathname);
  if (shoppingListEditMatch) {
    return shoppingListEditRoute(Number(shoppingListEditMatch[1]));
  }
  return appRoutes.find((route) => route.path === normalizedPathname) ?? appRoutes[0];
}

function shoppingListEditRoute(shoppingListId: number): AppRoute {
  return {
    path: `/shopping-lists/manage/${shoppingListId}`,
    view: "shopping-lists",
    shoppingListsTab: "manage",
    shoppingListId
  };
}

function recipeEditRoute(recipeId: number): AppRoute {
  return {
    path: `/recipes/manage/${recipeId}`,
    view: "recipe-admin",
    recipeAdminTab: "manage",
    recipeId
  };
}

function defaultRouteForView(view: AppView) {
  return appRoutes.find((route) => route.view === view) ?? appRoutes[0];
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Data-Scope": getInitialDataScope(),
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

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

function App() {
  const [activeRoute, setActiveRoute] = useState<AppRoute>(() => routeFromPathname(window.location.pathname));
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialTheme);
  const [dataScope, setDataScope] = useState<DataScope>(getInitialDataScope);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [customShoppingLists, setCustomShoppingLists] = useState<CustomShoppingList[]>([]);
  const [activeMenu, setActiveMenu] = useState<Menu | null>(null);
  const [shoppingList, setShoppingList] = useState<ShoppingListItem[]>([]);
  const [dirtyShoppingItemIds, setDirtyShoppingItemIds] = useState<Set<number>>(() => new Set());
  const [sourceMetadataDirtyItemIds, setSourceMetadataDirtyItemIds] = useState<Set<number>>(() => new Set());
  const [savingApprovalItemIds, setSavingApprovalItemIds] = useState<Set<number>>(() => new Set());
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
    setRecipes((await api<Array<Recipe | null>>("/api/recipes")).filter(Boolean) as Recipe[]);
  }

  async function loadCustomShoppingLists() {
    setCustomShoppingLists(await api<CustomShoppingList[]>("/api/custom-shopping-lists"));
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
    const latestMenu = await api<Menu | null>("/api/menus/latest");
    if (!latestMenu || latestMenu.id === null) {
      setActiveMenu(null);
      setShoppingList([]);
      return;
    }

    const latestShoppingList = await api<ShoppingListItem[]>(`/api/menus/${latestMenu.id}/shopping-list`);
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
      const preview = await api<Menu>("/api/menus/preview", {
        method: "POST",
        body: JSON.stringify({ mealCount })
      });
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
      const created = await api<{ id: number }>("/api/menus", {
        method: "POST",
        body: JSON.stringify({
          name: activeMenu.name,
          mealCount: activeMenu.mealCount,
          customShoppingListIds: activeMenu.customShoppingListIds,
          items: activeMenu.items.map(({ mealNumber, slot, recipeId }) => ({ mealNumber, slot, recipeId }))
        })
      });
      setActiveMenu(await api<Menu>(`/api/menus/${created.id}`));
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
    setActiveMenu(await api<Menu>(`/api/menus/${id}`));
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

    await api(`/api/menu-items/${menuItemId}`, {
      method: "PUT",
      body: JSON.stringify({ recipeId })
    });
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
        : await api<Menu>(`/api/menus/${activeMenu.id}/meals`, {
          method: "POST",
          body: JSON.stringify({
            items: newItems.map(({ mealNumber, slot, recipeId }) => ({ mealNumber, slot, recipeId }))
          })
        });
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
        : await api<Menu>(`/api/menus/${activeMenu.id}/meals/${mealNumber}`, { method: "DELETE" });
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
      await api(`/api/menus/${activeMenu.id}/custom-shopping-lists`, {
        method: "PUT",
        body: JSON.stringify({ customShoppingListIds: nextIds })
      });
      await api(`/api/menus/${activeMenu.id}/shopping-list`, { method: "DELETE" });
    }
  }

  async function aggregateIngredients() {
    if (!activeMenu) return;
    if (activeMenu.id === null) {
      setMessage("Save the menu before aggregating ingredients.");
      return;
    }
    await api(`/api/menus/${activeMenu.id}/aggregate`, { method: "POST" });
    setShoppingList(await api<ShoppingListItem[]>(`/api/menus/${activeMenu.id}/shopping-list`));
    setDirtyShoppingItemIds(new Set());
    setSourceMetadataDirtyItemIds(new Set());
    setStoreItemReview(null);
    setStoreItemReviewMessage("");
  }

  async function clearAggregatedIngredients() {
    if (!activeMenu?.id) return;
    await api(`/api/menus/${activeMenu.id}/shopping-list`, { method: "DELETE" });
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

    await api(`/api/menus/${activeMenu.id}/shopping-list/items`, {
      method: "PUT",
      body: JSON.stringify({
        items: dirtyItems.map((item) => ({ ...item, approved: Boolean(item.approved) }))
      })
    });

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

    setMessage("");
    setStoreItemReview(null);
    setShoppingList((current) => current.map((item) => (
      item.id === itemId ? { ...item, approved: approved ? 1 : 0 } : item
    )));
    setSavingApprovalItemIds((current) => new Set(current).add(itemId));

    try {
      await api(`/api/menus/${activeMenu.id}/shopping-list/items/${itemId}/approval`, {
        method: "PATCH",
        body: JSON.stringify({ approved })
      });
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
    }
  }

  async function saveShoppingItemToSource(item: ShoppingListItem) {
    if (!activeMenu?.id || savingSourceItemIds.has(item.id)) return;

    setMessage("");
    setSavingSourceItemIds((current) => new Set(current).add(item.id));
    try {
      const result = await api<{ item: ShoppingListItem; sourceType: "recipe" | "custom"; sourceId: number }>(
        `/api/menus/${activeMenu.id}/shopping-list/items/${item.id}/source`,
        {
          method: "PATCH",
          body: JSON.stringify({
            text: item.text,
            quantity: item.quantity,
            unit: item.unit,
            item: item.item
          })
        }
      );
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
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to save item details to the source.");
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

    const result = await api<{
      match: StoreItemMatch | null;
      matched: StoreItemMatch[];
      skipped: QfcCartSkip[];
      resultCount: number;
    }>(
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
      const result = await api<{
        removedItem: ShoppingListItem;
        items: ShoppingListItem[];
        matched: StoreItemMatch[];
        skipped: QfcCartSkip[];
      }>(`/api/store-item-reviews/${storeItemReview.jobId}/items/${item.id}`, { method: "DELETE" });
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
          <RecipeAdmin
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
          <ShoppingListsAdmin
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
            addMeal={addMeal}
            removeMeal={removeMeal}
            updateCustomShoppingListSelection={updateCustomShoppingListSelection}
            aggregateIngredients={aggregateIngredients}
          />
            <ShoppingListReview
              items={shoppingList}
              setItems={setShoppingList}
              openSource={(source) => navigate(
                source.type === "recipe"
                  ? recipeEditRoute(source.id)
                  : shoppingListEditRoute(source.id)
              )}
              markItemDirty={(id) => {
                setStoreItemReview(null);
                setDirtyShoppingItemIds((current) => {
                  const next = new Set(current);
                  next.add(id);
                  return next;
                });
              }}
              markSourceMetadataDirty={(id) => {
                setSourceMetadataDirtyItemIds((current) => new Set(current).add(id));
              }}
              sourceMetadataDirtyItemIds={sourceMetadataDirtyItemIds}
              savingApprovalItemIds={savingApprovalItemIds}
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

function ShoppingListsAdmin({
  activeTab,
  editingListId,
  lists,
  onEdit,
  onExitEdit,
  onTabChange,
  onSaved
}: {
  activeTab: ShoppingListsTab;
  editingListId: number | null;
  lists: CustomShoppingList[];
  onEdit: (listId: number) => void;
  onExitEdit: () => void;
  onTabChange: (tab: ShoppingListsTab) => void;
  onSaved: () => Promise<void>;
}) {
  const editingList = lists.find((list) => list.id === editingListId) ?? null;

  async function createList(payload: CustomShoppingListFormPayload) {
    const createdList = await api<CustomShoppingList>("/api/custom-shopping-lists", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await onSaved();
    return createdList;
  }

  async function updateList(payload: CustomShoppingListFormPayload) {
    if (!editingList) return;
    await api(`/api/custom-shopping-lists/${editingList.id}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    await onSaved();
    onExitEdit();
  }

  async function deleteList() {
    if (!editingList) return;
    await api(`/api/custom-shopping-lists/${editingList.id}`, { method: "DELETE" });
    await onSaved();
    onExitEdit();
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <ListChecks size={18} />
        <h3>Shopping Lists</h3>
      </div>
      <div className="sub-tabs" role="tablist" aria-label="Shopping list sections">
        <button
          className={`sub-tab-button ${activeTab === "manage" ? "active" : ""}`}
          onClick={() => onTabChange("manage")}
          role="tab"
          aria-selected={activeTab === "manage"}
          type="button"
        >
          Manage Lists
        </button>
        <button
          className={`sub-tab-button ${activeTab === "create" ? "active" : ""}`}
          onClick={() => onTabChange("create")}
          role="tab"
          aria-selected={activeTab === "create"}
          type="button"
        >
          Add List
        </button>
      </div>

      {activeTab === "create" ? (
        <CustomShoppingListForm mode="create" onSubmit={createList} />
      ) : editingList ? (
        <CustomShoppingListForm
          mode="edit"
          initialList={editingList}
          onCancel={onExitEdit}
          onDelete={deleteList}
          onSubmit={updateList}
        />
      ) : (
        <div className="tab-panel" role="tabpanel">
          {lists.length ? (
            <div className="recipe-list shopping-list-management-list">
              {lists.map((list) => (
                <button
                  className="recipe-list-item recipe-management-item shopping-list-management-item"
                  key={list.id}
                  onClick={() => onEdit(list.id)}
                  type="button"
                >
                  <div className="recipe-management-copy">
                    <strong>{list.name}</strong>
                  </div>
                  <div className="recipe-management-meta">
                    <span className="recipe-meta-chip">
                      {list.items.length} {list.items.length === 1 ? "item" : "items"}
                    </span>
                    <span
                      className={`recipe-meta-chip recipe-status-chip ${
                        list.includeInMenuByDefault ? "enabled" : ""
                      }`}
                    >
                      {list.includeInMenuByDefault ? "Included by default" : "Not included by default"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state">No custom shopping lists have been added yet.</div>
          )}
        </div>
      )}
    </section>
  );
}

type CustomShoppingListFormPayload = {
  name: string;
  includeInMenuByDefault: boolean;
  items: CustomShoppingListItem[];
};

function emptyCustomShoppingListItem(): CustomShoppingListItem {
  return { text: "", quantity: "", unit: "", item: "" };
}

function CustomShoppingListForm({
  mode,
  initialList,
  onCancel,
  onDelete,
  onSubmit
}: {
  mode: "create" | "edit";
  initialList?: CustomShoppingList;
  onCancel?: () => void;
  onDelete?: () => Promise<void>;
  onSubmit: (payload: CustomShoppingListFormPayload) => Promise<CustomShoppingList | void>;
}) {
  const initialForm = () => ({
    name: initialList?.name ?? "",
    includeInMenuByDefault: initialList?.includeInMenuByDefault ?? false,
    items: initialList?.items.length
      ? initialList.items.map((item) => ({ ...item }))
      : [emptyCustomShoppingListItem()]
  });
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [createdList, setCreatedList] = useState<CustomShoppingList | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const itemEditorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setForm(initialForm());
    setError("");
    setCreatedList(null);
  }, [initialList?.id]);

  function moveItem(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= form.items.length) return;
    setForm((current) => {
      const items = [...current.items];
      [items[index], items[nextIndex]] = [items[nextIndex], items[index]];
      return { ...current, items };
    });
  }

  function addItem() {
    setForm((current) => ({
      ...current,
      items: [...current.items, emptyCustomShoppingListItem()]
    }));
    window.requestAnimationFrame(() => {
      const itemInputs = itemEditorRef.current?.querySelectorAll<HTMLInputElement>(".custom-list-item-input");
      itemInputs?.[itemInputs.length - 1]?.focus();
    });
  }

  async function saveList() {
    const items = form.items
      .map((entry) => {
        const item = entry.item.trim();
        return { ...entry, item, text: entry.text.trim() || item };
      })
      .filter((entry) => entry.item);
    setError("");
    setCreatedList(null);
    setIsSubmitting(true);
    try {
      const savedList = await onSubmit({
        name: form.name.trim(),
        includeInMenuByDefault: form.includeInMenuByDefault,
        items
      });
      if (mode === "create") {
        if (savedList) {
          setCreatedList(savedList);
        }
        setForm({
          name: "",
          includeInMenuByDefault: false,
          items: [emptyCustomShoppingListItem()]
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the shopping list.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function deleteList() {
    if (!onDelete || !initialList) return;
    if (!window.confirm(`Delete “${initialList.name}”? This action cannot be undone.`)) return;
    setError("");
    setIsSubmitting(true);
    try {
      await onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete the shopping list.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="tab-panel" role="tabpanel">
      {mode === "edit" ? (
        <div className="edit-heading">
          <div>
            <div className="subhead">Editing shopping list</div>
            <strong>{initialList?.name}</strong>
          </div>
          <button className="secondary" onClick={onCancel} type="button">
            <X size={17} />
            Cancel
          </button>
        </div>
      ) : null}

      <label>
        Name
        <input
          value={form.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          placeholder="Robin’s regulars"
        />
      </label>

      <label className="toggle-row">
        <input
          type="checkbox"
          checked={form.includeInMenuByDefault}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              includeInMenuByDefault: event.target.checked
            }))
          }
        />
        <span>Include in new menus by default</span>
      </label>

      <div className="ingredient-editor custom-list-item-editor" ref={itemEditorRef}>
        <div className="subhead">Items</div>
        {form.items.map((entry, index) => (
          <div className="custom-list-item-row" key={`${entry.id ?? "new"}-${index}`}>
            <input
              className="custom-list-item-input"
              value={entry.item}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  items: current.items.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, item: event.target.value, text: event.target.value } : item
                  )
                }))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  addItem();
                }
              }}
              placeholder="Coffee"
            />
            <button
              className="icon-button secondary"
              disabled={index === 0}
              onClick={() => moveItem(index, -1)}
              aria-label="Move item up"
              type="button"
            >
              <ChevronUp size={16} />
            </button>
            <button
              className="icon-button secondary"
              disabled={index === form.items.length - 1}
              onClick={() => moveItem(index, 1)}
              aria-label="Move item down"
              type="button"
            >
              <ChevronDown size={16} />
            </button>
            <button
              className="icon-button"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  items: current.items.filter((_, itemIndex) => itemIndex !== index)
                }))
              }
              aria-label="Remove item"
              type="button"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <button
          className="secondary"
          onClick={addItem}
          type="button"
        >
          <Plus size={17} />
          Add item
        </button>
      </div>

      {error ? <div className="error">{error}</div> : null}
      {createdList ? (
        <div className="success" role="status">
          Shopping list “{createdList.name}” was created successfully.{" "}
          <a href={shoppingListEditRoute(createdList.id).path}>View shopping list</a>
        </div>
      ) : null}
      <div className="panel-actions">
        {mode === "edit" ? (
          <button
            className="danger delete-recipe-button"
            disabled={isSubmitting}
            onClick={() => void deleteList()}
            type="button"
          >
            <Trash2 size={17} />
            Delete list
          </button>
        ) : null}
        <button disabled={isSubmitting} onClick={() => void saveList()} type="button">
          <Check size={17} />
          {mode === "create" ? "Save list" : "Update list"}
        </button>
      </div>
    </div>
  );
}

function RecipeAdmin({
  activeTab,
  editingRecipeId,
  onEdit,
  onExitEdit,
  onTabChange,
  recipes,
  recipeCounts,
  onSaved
}: {
  activeTab: RecipeAdminTab;
  editingRecipeId: number | null;
  onEdit: (recipeId: number) => void;
  onExitEdit: () => void;
  onTabChange: (tab: RecipeAdminTab) => void;
  recipes: Recipe[];
  recipeCounts: RecipeCategoryCount[];
  onSaved: () => Promise<void>;
}) {
  const editingRecipe = recipes.find((recipe) => recipe.id === editingRecipeId) ?? null;

  async function createRecipe(payload: RecipeFormPayload) {
    const createdRecipe = await api<Recipe>("/api/recipes", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await onSaved();
    return createdRecipe;
  }

  async function updateRecipe(payload: RecipeFormPayload) {
    if (!editingRecipe) {
      return;
    }

    await api(`/api/recipes/${editingRecipe.id}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    await onSaved();
    onExitEdit();
  }

  async function deleteRecipe() {
    if (!editingRecipe) {
      return;
    }

    await api(`/api/recipes/${editingRecipe.id}`, { method: "DELETE" });
    await onSaved();
    onExitEdit();
  }

  async function toggleRecipeGeneration(recipe: Recipe) {
    await api(`/api/recipes/${recipe.id}/menu-generation`, {
      method: "PATCH",
      body: JSON.stringify({
        includeInMenuGeneration: !recipe.includeInMenuGeneration
      })
    });
    await onSaved();
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <Database size={18} />
        <h3>Recipes</h3>
      </div>

      <div className="sub-tabs" role="tablist" aria-label="Recipe sections">
        <button
          className={`sub-tab-button ${activeTab === "manage" ? "active" : ""}`}
          onClick={() => onTabChange("manage")}
          role="tab"
          aria-selected={activeTab === "manage"}
          type="button"
        >
          Manage Recipes
        </button>
        <button
          className={`sub-tab-button ${activeTab === "create" ? "active" : ""}`}
          onClick={() => onTabChange("create")}
          role="tab"
          aria-selected={activeTab === "create"}
          type="button"
        >
          Add Recipe
        </button>
      </div>

      {activeTab === "create" ? (
        <RecipeForm mode="create" onSubmit={createRecipe} />
      ) : editingRecipe ? (
        <RecipeForm
          mode="edit"
          initialRecipe={editingRecipe}
          onCancel={onExitEdit}
          onDelete={deleteRecipe}
          onSubmit={updateRecipe}
        />
      ) : (
        <RecipeManagementList
          recipes={recipes}
          recipeCounts={recipeCounts}
          onEdit={onEdit}
          onToggleGeneration={toggleRecipeGeneration}
        />
      )}
    </section>
  );
}

type RecipeFormPayload = {
  name: string;
  category: RecipeCategory;
  includeInMenuGeneration: boolean;
  servings: number | null;
  notes: string;
  ingredients: RecipeIngredient[];
};

function recipeFormInitialState(recipe?: Recipe) {
  return {
    name: recipe?.name ?? "",
    category: recipe?.category ?? "entree",
    includeInMenuGeneration: recipe?.includeInMenuGeneration ?? true,
    servings: recipe?.servings === null || recipe?.servings === undefined ? "" : String(recipe.servings),
    notes: recipe?.notes ?? "",
    ingredients: recipe?.ingredients.length
      ? recipe.ingredients.map((ingredient) => ({ ...ingredient }))
      : [emptyIngredient()]
  };
}

function RecipeForm({
  mode,
  initialRecipe,
  onCancel,
  onDelete,
  onSubmit
}: {
  mode: "create" | "edit";
  initialRecipe?: Recipe;
  onCancel?: () => void;
  onDelete?: () => Promise<void>;
  onSubmit: (payload: RecipeFormPayload) => Promise<Recipe | void>;
}) {
  const [form, setForm] = useState(() => recipeFormInitialState(initialRecipe));
  const [error, setError] = useState("");
  const [createdRecipe, setCreatedRecipe] = useState<Recipe | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const ingredientEditorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setForm(recipeFormInitialState(initialRecipe));
    setError("");
    setCreatedRecipe(null);
  }, [initialRecipe?.id]);

  function updateIngredient(index: number, patch: Partial<RecipeIngredient>) {
    setForm((current) => ({
      ...current,
      ingredients: current.ingredients.map((ingredient, i) => (i === index ? { ...ingredient, ...patch } : ingredient))
    }));
  }

  function addIngredient() {
    setForm((current) => ({
      ...current,
      ingredients: [...current.ingredients, emptyIngredient()]
    }));
    window.requestAnimationFrame(() => {
      const itemInputs = ingredientEditorRef.current?.querySelectorAll<HTMLInputElement>(".ingredient-item-input");
      itemInputs?.[itemInputs.length - 1]?.focus();
    });
  }

  async function saveRecipe() {
    setError("");
    setCreatedRecipe(null);
    const savedIngredients = form.ingredients
      .map(normalizeRecipeIngredient)
      .filter((ingredient): ingredient is RecipeIngredient => ingredient !== null);

    try {
      setIsSubmitting(true);
      const savedRecipe = await onSubmit({
        name: form.name,
        category: form.category,
        includeInMenuGeneration: form.includeInMenuGeneration,
        servings: form.servings ? Number(form.servings) : null,
        notes: form.notes,
        ingredients: savedIngredients
      });

      if (mode === "create") {
        if (savedRecipe) {
          setCreatedRecipe(savedRecipe);
        }
        setForm(recipeFormInitialState());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : mode === "create" ? "Unable to save recipe." : "Unable to update recipe.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function deleteRecipe() {
    if (!onDelete || !initialRecipe) {
      return;
    }

    const confirmed = window.confirm(`Delete “${initialRecipe.name}”? This action cannot be undone.`);
    if (!confirmed) {
      return;
    }

    setError("");
    setIsSubmitting(true);
    try {
      await onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete recipe.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="tab-panel" role="tabpanel">
      {mode === "edit" ? (
        <div className="edit-heading">
          <div>
            <div className="subhead">Editing recipe</div>
            <strong>{initialRecipe?.name}</strong>
          </div>
          <button className="secondary" onClick={onCancel} type="button">
            <X size={17} />
            Cancel
          </button>
        </div>
      ) : null}

      <div className="form-grid">
        <label>
          Name
          <input
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Lemon chicken"
          />
        </label>
        <label>
          Category
          <select
            value={form.category}
            onChange={(event) => setForm((current) => ({ ...current, category: event.target.value as RecipeCategory }))}
          >
            {categories.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Servings
          <input
            value={form.servings}
            onChange={(event) => setForm((current) => ({ ...current, servings: event.target.value }))}
            inputMode="numeric"
          />
        </label>
      </div>

      <label className="toggle-row">
        <input
          type="checkbox"
          checked={form.includeInMenuGeneration}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              includeInMenuGeneration: event.target.checked
            }))
          }
        />
        <span>Include in automatic menu generation</span>
      </label>

      <label>
        Notes
        <textarea
          value={form.notes}
          onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
          rows={3}
        />
      </label>

      <div className="ingredient-editor" ref={ingredientEditorRef}>
        <div className="subhead">Ingredients</div>
        {form.ingredients.map((ingredient, index) => (
          <div
            className={`ingredient-row ${mode === "create" ? "ingredient-row-create" : ""}`}
            key={`${ingredient.id ?? "new"}-${index}`}
          >
            <input
              value={ingredient.quantity}
              onChange={(event) => updateIngredient(index, { quantity: event.target.value })}
              placeholder="2"
            />
            <input
              value={ingredient.unit}
              onChange={(event) => updateIngredient(index, { unit: event.target.value })}
              placeholder="cups"
            />
            <input
              className="ingredient-item-input"
              value={ingredient.item}
              onChange={(event) => updateIngredient(index, { item: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  addIngredient();
                }
              }}
              placeholder="rice"
            />
            {mode === "edit" ? (
              <input
                value={ingredient.text}
                onChange={(event) => updateIngredient(index, { text: event.target.value })}
                placeholder="2 cups rice"
              />
            ) : null}
            <button
              className="icon-button danger"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  ingredients: current.ingredients.filter((_, i) => i !== index)
                }))
              }
              aria-label="Remove ingredient"
              type="button"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <button
          className="secondary"
          onClick={addIngredient}
          type="button"
        >
          Add ingredient
        </button>
      </div>

      {error ? <div className="error">{error}</div> : null}
      {createdRecipe ? (
        <div className="success" role="status">
          Recipe “{createdRecipe.name}” was created successfully.{" "}
          <a href={recipeEditRoute(createdRecipe.id).path}>View recipe</a>
        </div>
      ) : null}

      <div className="panel-actions">
        {mode === "edit" ? (
          <button
            className="danger delete-recipe-button"
            aria-busy={isSubmitting}
            disabled={isSubmitting}
            onClick={() => void deleteRecipe()}
            type="button"
          >
            <Trash2 size={17} />
            Delete recipe
          </button>
        ) : null}
        <button aria-busy={isSubmitting} disabled={isSubmitting} onClick={() => void saveRecipe()} type="button">
          <Check size={17} />
          {mode === "create" ? "Save recipe" : "Update recipe"}
        </button>
      </div>
    </div>
  );
}

function RecipeManagementList({
  recipes,
  recipeCounts,
  onEdit,
  onToggleGeneration
}: {
  recipes: Recipe[];
  recipeCounts: RecipeCategoryCount[];
  onEdit: (recipeId: number) => void;
  onToggleGeneration: (recipe: Recipe) => Promise<void>;
}) {
  const [managementPage, setManagementPage] = useState(0);
  const [generationUpdateId, setGenerationUpdateId] = useState<number | null>(null);
  const [generationUpdateError, setGenerationUpdateError] = useState("");
  const managementPageCount = Math.max(1, Math.ceil(recipes.length / recipeManagementPageSize));
  const currentManagementPage = Math.min(managementPage, managementPageCount - 1);
  const managementPageStart = currentManagementPage * recipeManagementPageSize;
  const visibleManagementRecipes = recipes.slice(managementPageStart, managementPageStart + recipeManagementPageSize);
  const managementRangeStart = recipes.length === 0 ? 0 : managementPageStart + 1;
  const managementRangeEnd = Math.min(recipes.length, managementPageStart + visibleManagementRecipes.length);

  useEffect(() => {
    setManagementPage((current) => Math.min(current, managementPageCount - 1));
  }, [managementPageCount]);

  async function toggleGeneration(recipe: Recipe) {
    setGenerationUpdateError("");
    setGenerationUpdateId(recipe.id);
    try {
      await onToggleGeneration(recipe);
    } catch (err) {
      setGenerationUpdateError(
        err instanceof Error ? err.message : "Unable to update menu generation."
      );
    } finally {
      setGenerationUpdateId(null);
    }
  }

  return (
    <div className="tab-panel" role="tabpanel">
      <div className="recipe-count-summary" aria-label="Recipe category counts">
        {recipeCounts.map((category) => (
          <div key={category.value}>
            <span>{category.label}</span>
            <strong>{category.count}</strong>
          </div>
        ))}
      </div>

      <div className="recipe-management-header">
        <div>
          <div className="subhead">Recipes</div>
          <span>
            Showing {managementRangeStart}-{managementRangeEnd} of {recipes.length}
          </span>
        </div>
        <div className="pagination-controls" aria-label="Recipe list pagination">
          <button
            className="icon-button secondary"
            onClick={() => setManagementPage((current) => Math.max(0, current - 1))}
            disabled={currentManagementPage === 0}
            aria-label="Previous recipe page"
            type="button"
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            Page {currentManagementPage + 1} of {managementPageCount}
          </span>
          <button
            className="icon-button secondary"
            onClick={() => setManagementPage((current) => Math.min(managementPageCount - 1, current + 1))}
            disabled={currentManagementPage >= managementPageCount - 1}
            aria-label="Next recipe page"
            type="button"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {generationUpdateError ? <div className="error">{generationUpdateError}</div> : null}

      {visibleManagementRecipes.length === 0 ? (
        <div className="empty-state">No recipes have been added yet.</div>
      ) : (
        <div className="recipe-list recipe-management-list">
          {visibleManagementRecipes.map((recipe) => (
            <div key={recipe.id} className="recipe-list-item recipe-management-item">
              <button
                className="recipe-management-edit"
                onClick={() => onEdit(recipe.id)}
                aria-label={`Edit ${recipe.name}`}
                type="button"
              >
                <div className="recipe-management-copy">
                  <strong>{recipe.name}</strong>
                  {recipe.notes ? <span>{recipe.notes}</span> : null}
                </div>
              </button>
              <div className="recipe-management-meta">
                <span className="recipe-meta-chip">
                  {categories.find((item) => item.value === recipe.category)?.label}
                </span>
                <span className="recipe-meta-chip">
                  {recipe.servings === null ? "Servings not set" : `${recipe.servings} servings`}
                </span>
                <button
                  className={`recipe-meta-chip recipe-status-chip recipe-generation-toggle ${
                    recipe.includeInMenuGeneration ? "enabled" : ""
                  }`}
                  aria-busy={generationUpdateId === recipe.id}
                  aria-label={`${
                    recipe.includeInMenuGeneration ? "Disable" : "Enable"
                  } menu generation for ${recipe.name}`}
                  aria-pressed={recipe.includeInMenuGeneration}
                  disabled={generationUpdateId !== null}
                  onClick={() => void toggleGeneration(recipe)}
                  type="button"
                >
                  {recipe.includeInMenuGeneration ? "Generation on" : "Generation off"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MenuBuilder({
  recipes,
  customShoppingLists,
  mealCount,
  setMealCount,
  activeMenu,
  generateMenu,
  saveMenu,
  updateMenuItem,
  addMeal,
  removeMeal,
  updateCustomShoppingListSelection,
  aggregateIngredients
}: {
  recipes: Recipe[];
  customShoppingLists: CustomShoppingList[];
  mealCount: number | "";
  setMealCount: (value: number | "") => void;
  activeMenu: Menu | null;
  generateMenu: () => Promise<void>;
  saveMenu: () => Promise<void>;
  updateMenuItem: (
    menuItemId: number | null,
    mealNumber: number,
    slot: RecipeCategory,
    recipeId: number | null
  ) => Promise<void>;
  addMeal: () => Promise<void>;
  removeMeal: (mealNumber: number) => Promise<void>;
  updateCustomShoppingListSelection: (listId: number, included: boolean) => Promise<void>;
  aggregateIngredients: () => Promise<void>;
}) {
  const plannerRecipes = recipes;

  return (
    <section className="panel">
      <div className="panel-heading">
        <Shuffle size={18} />
        <h3>Menu Builder</h3>
      </div>

      <div className="menu-controls">
        <label>
          Meals
          <input
            type="number"
            min={1}
            max={14}
            value={mealCount}
            onChange={(event) =>
              setMealCount(event.target.value === "" ? "" : Number(event.target.value))
            }
          />
        </label>
        <button
          disabled={mealCount === "" || mealCount < 1 || mealCount > 14}
          onClick={() => void generateMenu()}
        >
          <Shuffle size={17} />
          Generate
        </button>
      </div>

      {activeMenu ? (
        <div className="menu-table">
          {Array.from({ length: activeMenu.mealCount }, (_, index) => index + 1).map((mealNumber) => (
            <div className="meal-block" key={mealNumber}>
              <div className="meal-heading">
                <strong>Meal {mealNumber}</strong>
                <button
                  className="icon-button danger"
                  type="button"
                  onClick={() => void removeMeal(mealNumber)}
                  disabled={activeMenu.mealCount === 1}
                  aria-label={`Remove meal ${mealNumber}`}
                  title={activeMenu.mealCount === 1 ? "A menu must include at least one meal" : `Remove meal ${mealNumber}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              {categories.map((category) => {
                const item = activeMenu.items.find(
                  (menuItem) => menuItem.mealNumber === mealNumber && menuItem.slot === category.value
                );
                return (
                  <label className={`menu-slot menu-slot-${category.value}`} key={category.value}>
                    {category.label}
                    <select
                      value={item?.recipeId ?? ""}
                      onChange={(event) =>
                        item &&
                        void updateMenuItem(
                          item.id,
                          mealNumber,
                          category.value,
                          event.target.value === "" ? null : Number(event.target.value)
                        )
                      }
                    >
                      {category.value !== "entree" ? <option value="">None</option> : null}
                      {plannerRecipes
                        .filter((recipe) => recipe.category === category.value)
                        .map((recipe) => (
                          <option key={recipe.id} value={recipe.id}>
                            {recipe.name}
                          </option>
                        ))}
                    </select>
                  </label>
                );
              })}
            </div>
          ))}
          <div className="menu-meal-actions">
            <button
              className="secondary"
              type="button"
              onClick={() => void addMeal()}
              disabled={activeMenu.mealCount >= 14}
            >
              <Plus size={17} />
              Add meal
            </button>
            <span>{activeMenu.mealCount} of 14 meals</span>
          </div>
          <div className="custom-list-picker">
            <div>
              <strong>Custom shopping lists</strong>
              <span>Include regular groceries when ingredients are aggregated.</span>
            </div>
            {customShoppingLists.length ? (
              <div className="custom-list-options">
                {customShoppingLists.map((list) => (
                  <label className="toggle-row" key={list.id}>
                    <input
                      type="checkbox"
                      checked={activeMenu.customShoppingListIds.includes(list.id)}
                      onChange={(event) =>
                        void updateCustomShoppingListSelection(list.id, event.target.checked)
                      }
                    />
                    <span>{list.name} ({list.items.length})</span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="empty-state compact">
                Add a custom shopping list from the Shopping Lists tab.
              </div>
            )}
          </div>
          <div className="panel-actions">
            {activeMenu.id === null ? (
              <button onClick={() => void saveMenu()}>
                <Check size={17} />
                Save menu
              </button>
            ) : (
              <button onClick={() => void aggregateIngredients()}>
                <Settings size={17} />
                Aggregate ingredients
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="empty-state">
          Select at least one entree recipe for menu generation, then generate a weekly menu.
        </div>
      )}
    </section>
  );
}

function ShoppingListReview({
  items,
  setItems,
  openSource,
  markItemDirty,
  markSourceMetadataDirty,
  sourceMetadataDirtyItemIds,
  savingApprovalItemIds,
  savingSourceItemIds,
  updateApproval,
  saveToSource,
  clearItems,
  previewStoreItems,
  qfcSubmitProgress,
  message
}: {
  items: ShoppingListItem[];
  setItems: (items: ShoppingListItem[]) => void;
  openSource: (source: ShoppingListSourceTarget) => void;
  markItemDirty: (id: number) => void;
  markSourceMetadataDirty: (id: number) => void;
  sourceMetadataDirtyItemIds: Set<number>;
  savingApprovalItemIds: Set<number>;
  savingSourceItemIds: Set<number>;
  updateApproval: (id: number, approved: boolean) => Promise<void>;
  saveToSource: (item: ShoppingListItem) => Promise<void>;
  clearItems: () => Promise<void>;
  previewStoreItems: () => Promise<void>;
  qfcSubmitProgress: QfcSubmitProgress | null;
  message: string;
}) {
  const [showUncheckedItems, setShowUncheckedItems] = useState(false);
  const approvedItems = items.filter((item) => Boolean(item.approved));
  const uncheckedItems = items.filter((item) => !item.approved);

  function patchItem(item: ShoppingListItem, patch: Partial<ShoppingListItem>) {
    const id = item.id;
    setItems(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    markItemDirty(id);
    if (item.canPersistToSource) {
      markSourceMetadataDirty(id);
    }
  }

  function renderShoppingRow(item: ShoppingListItem) {
    return (
      <div className="shopping-row" key={item.id}>
        <label className="compact-checkbox">
          <input
            type="checkbox"
            checked={Boolean(item.approved)}
            disabled={savingApprovalItemIds.has(item.id)}
            onChange={(event) => void updateApproval(item.id, event.target.checked)}
          />
          {savingApprovalItemIds.has(item.id) ? <span className="approval-save-status">Saving...</span> : null}
        </label>
        <input
          value={item.quantity}
          disabled={savingSourceItemIds.has(item.id)}
          onChange={(event) => patchItem(item, { quantity: event.target.value })}
        />
        <input
          value={item.unit}
          disabled={savingSourceItemIds.has(item.id)}
          onChange={(event) => patchItem(item, { unit: event.target.value })}
        />
        <input
          value={item.item}
          disabled={savingSourceItemIds.has(item.id)}
          onChange={(event) => patchItem(item, { item: event.target.value })}
        />
        <input
          value={item.text}
          disabled={savingSourceItemIds.has(item.id)}
          onChange={(event) => patchItem(item, { text: event.target.value })}
        />
        <div className="shopping-source">
          {item.sourceTargets.length ? (
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
          ) : (
            <span>{item.sourceNames}</span>
          )}
          {!item.canPersistToSource ? (
            <small>
              {item.sourceOccurrenceCount
                ? `Shopping list only - ${item.sourceOccurrenceCount} sources`
                : "Re-aggregate to enable source editing"}
            </small>
          ) : null}
        </div>
        {item.canPersistToSource ? (
          <button
            className="secondary shopping-save-recipe-button"
            type="button"
            aria-busy={savingSourceItemIds.has(item.id)}
            disabled={!sourceMetadataDirtyItemIds.has(item.id) || savingSourceItemIds.has(item.id)}
            onClick={() => void saveToSource(item)}
          >
            {savingSourceItemIds.has(item.id) ? "Saving..." : "Save to source"}
          </button>
        ) : (
          <span className="shopping-persistence-status">Multiple sources</span>
        )}
      </div>
    );
  }

  return (
    <section className="panel full-width">
      <div className="panel-heading">
        <Check size={18} />
        <h3>Ingredient Review</h3>
      </div>

      {items.length ? (
        <>
          <div className="shopping-table">
            {approvedItems.map(renderShoppingRow)}
            {uncheckedItems.length ? (
              <>
                <button
                  className="unchecked-ingredients-toggle"
                  type="button"
                  aria-expanded={showUncheckedItems}
                  onClick={() => setShowUncheckedItems((current) => !current)}
                >
                  <ChevronRight size={17} aria-hidden="true" />
                  <span>
                    {uncheckedItems.length} unchecked ingredient{uncheckedItems.length === 1 ? "" : "s"}
                  </span>
                </button>
                {showUncheckedItems ? uncheckedItems.map(renderShoppingRow) : null}
              </>
            ) : null}
          </div>
          <div className="panel-actions">
            <button className="secondary" onClick={() => void clearItems()}>
              <Trash2 size={17} />
              Clear aggregated ingredients
            </button>
            <button
              aria-busy={Boolean(qfcSubmitProgress)}
              onClick={() => void previewStoreItems()}
              disabled={Boolean(qfcSubmitProgress)}
            >
              <Send size={17} />
              {qfcSubmitProgress ? "Matching store items..." : "Review store items"}
            </button>
          </div>
        </>
      ) : (
        <div className="empty-state">Aggregate a menu to review its grocery list.</div>
      )}

      {qfcSubmitProgress && qfcSubmitProgress.phase !== "adding" ? <QfcSubmitProgressBar progress={qfcSubmitProgress} /> : null}
      {message ? <div className="success">{message}</div> : null}
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
                    <span>{match.item.sourceNames}</span>
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
                    {renderFindItemControl(match.item)}
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

function QfcSubmitProgressBar({ progress }: { progress: QfcSubmitProgress }) {
  const fallbackByPhase = {
    checking: 8,
    matching: 20,
    adding: 92,
    complete: 100
  };
  const itemPercent = progress.totalItems
    ? Math.round((progress.processedItems / progress.totalItems) * 80) + 10
    : fallbackByPhase[progress.phase];
  const percent = progress.phase === "complete"
    ? 100
    : Math.min(96, Math.max(fallbackByPhase[progress.phase], itemPercent));

  return (
    <div className="qfc-progress" role="status" aria-live="polite">
      <div className="qfc-progress-meta">
        <strong>{progress.message}</strong>
        <span>{percent}%</span>
      </div>
      <div className="qfc-progress-track" aria-hidden="true">
        <div className="qfc-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
