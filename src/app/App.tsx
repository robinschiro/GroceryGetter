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
  type AppView
} from "./router.js";
import type {
  CustomShoppingList,
  DataScope,
  Menu,
  MenuItem,
  QfcCartSkip,
  QfcStatus,
  QfcSubmitJob,
  QfcSubmitProgress,
  Recipe,
  RecipeCategory,
  ShoppingListItem,
  ShoppingListSourceTarget,
  StoreItemMatch,
  StoreItemPreference
} from "../../shared/contracts/index.js";
import { createApiClient } from "../shared/apiClient.js";
import { listRecipes } from "../features/recipes/api.js";
import {
  RecipesPage,
  recipeCategories
} from "../features/recipes/RecipesPage.js";
import { listShoppingLists } from "../features/shoppingLists/api.js";
import { ShoppingListsPage } from "../features/shoppingLists/ShoppingListsPage.js";
import { MenuBuilder } from "../features/planner/MenuBuilder.js";
import { ShoppingListReview } from "../features/planner/ShoppingListReview.js";
import { usePlanner } from "../features/planner/usePlanner.js";
import { QfcSubmitProgressBar } from "../features/qfc/QfcSubmitProgressBar.js";
import { StoreSettingsPanel } from "../features/qfc/StoreSettingsPanel.js";
import {
  StoreItemReviewPanel,
  type StoreItemReview
} from "../features/qfc/StoreItemReviewPanel.js";
import {
  deleteStoreItemPreference as deleteStoreItemPreferenceRequest,
  getQfcSubmitJob,
  loadQfcSettings,
  removeStoreItemFromReview as removeStoreItemFromReviewRequest,
  searchStoreItemsForReview as searchStoreItemsForReviewRequest,
  selectStoreItem as selectStoreItemRequest,
  startAddToCart,
  startStoreItemPreview,
  updateScopedSetting,
  updateStoreItemQuantity as updateStoreItemQuantityRequest,
  type StoreItemReviewRemoval,
  type StoreItemReviewSearchResult
} from "../features/qfc/api.js";
import {
  updateShoppingListApproval
} from "../features/planner/api.js";

type ThemeMode = "light" | "dark";

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
  const [savingApprovalItemIds, setSavingApprovalItemIds] = useState<Set<number>>(() => new Set());
  const [searchingStoreItemIds, setSearchingStoreItemIds] = useState<Set<number>>(() => new Set());
  const [preferStoreBrands, setPreferStoreBrands] = useState(true);
  const [allowRealQfcCartMutation, setAllowRealQfcCartMutation] = useState(true);
  const [qfcStatus, setQfcStatus] = useState<QfcStatus | null>(null);
  const [qfcSubmitProgress, setQfcSubmitProgress] = useState<QfcSubmitProgress | null>(null);
  const [storeItemReview, setStoreItemReview] = useState<StoreItemReview | null>(null);
  const [storeItemReviewMessage, setStoreItemReviewMessage] = useState("");
  const [storeItemPreferences, setStoreItemPreferences] = useState<StoreItemPreference[]>([]);
  const {
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
    reset: resetPlanner,
    saveDirtyShoppingItems,
    saveMenu,
    saveShoppingItemToSource,
    savingSourceItemIds,
    setMealCount,
    setMessage,
    setShoppingList,
    shoppingList,
    sourceMetadataDirtyItemIds,
    updateCustomShoppingListSelection,
    updateMenuItem
  } = usePlanner({
    api,
    recipes,
    onSourcesChanged: async () => {
      await Promise.all([loadRecipes(), loadCustomShoppingLists()]);
    },
    onStoreReviewInvalidated: () => {
      setStoreItemReview(null);
      setStoreItemReviewMessage("");
    }
  });

  async function loadRecipes() {
    setRecipes(await listRecipes(api));
  }

  async function loadCustomShoppingLists() {
    setCustomShoppingLists(await listShoppingLists(api));
  }

  async function loadSettings() {
    const { settings, preferences, status } = await loadQfcSettings(api);
    setPreferStoreBrands(settings.preferStoreBrands === "true");
    setAllowRealQfcCartMutation(settings.allowRealQfcCartMutation === "true");
    setStoreItemPreferences(preferences);
    setQfcStatus(status);
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

  function updateDataScope(next: DataScope) {
    window.localStorage.setItem(dataScopeStorageKey, next);
    setDataScope(next);
    setRecipes([]);
    setCustomShoppingLists([]);
    resetPlanner(next === "sandbox" ? "Sandbox mode is active." : "");
    setStoreItemReview(null);
    setStoreItemReviewMessage("");
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
          const result = await removeStoreItemFromReviewRequest(api, currentReview.jobId, itemId);
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
          const result = await searchStoreItemsForReviewRequest(
            api,
            currentReview.jobId,
            itemId,
            previousItem.item || previousItem.text
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
      const started = await startStoreItemPreview(api, menuId);
      setQfcSubmitProgress(started.progress);

      let job = started;
      while (job.status === "running") {
        await wait(600);
        job = await getQfcSubmitJob(api, started.id);
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
      const started = await startAddToCart(api, storeItemReview.jobId);
      setQfcSubmitProgress(started.progress);
      let job = started;
      while (job.status === "running") {
        await wait(600);
        job = await getQfcSubmitJob(api, started.id);
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
    await updateScopedSetting(api, "preferStoreBrands", next);
  }

  async function updateRealQfcCartPermission(next: boolean) {
    setAllowRealQfcCartMutation(next);
    await updateScopedSetting(api, "allowRealQfcCartMutation", next);
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
      const result = await selectStoreItemRequest(
        api,
        storeItemReview.jobId,
        shoppingItemId,
        productId,
        upc
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
      const result = await updateStoreItemQuantityRequest(
        api,
        storeItemReview.jobId,
        shoppingItemId,
        cartQuantity
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

    const result = await searchStoreItemsForReviewRequest(
      api,
      storeItemReview.jobId,
      shoppingItemId,
      term
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
      const result = await removeStoreItemFromReviewRequest(api, storeItemReview.jobId, item.id);
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
    await deleteStoreItemPreferenceRequest(api, provider, ingredientKey);
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
