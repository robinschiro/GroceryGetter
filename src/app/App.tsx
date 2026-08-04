import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Database,
  History,
  ListChecks,
  Menu as MenuIcon,
  Moon,
  RefreshCw,
  Settings,
  Shuffle,
  Sun,
  X
} from "lucide-react";
import {
  defaultRouteForView,
  menuDetailRoute,
  recipeEditRoute,
  routeFromPathname,
  shoppingListEditRoute,
  type AppRoute,
  type AppView
} from "../shared/router.js";
import type {
  CustomShoppingList,
  DataScope,
  OurGroceriesListSummary,
  OurGroceriesStatus,
  Recipe
} from "../../shared/contracts/index.js";
import { createApiClient } from "../shared/apiClient.js";
import { listRecipes } from "../features/recipes/api.js";
import { RecipesPage } from "../features/recipes/RecipesPage.js";
import { recipeCategories } from "../shared/recipeCategories.js";
import { listShoppingLists } from "../features/shoppingLists/api.js";
import { ShoppingListsPage } from "../features/shoppingLists/ShoppingListsPage.js";
import { PlannerPage } from "../features/planner/PlannerPage.js";
import { usePlanner } from "../features/planner/usePlanner.js";
import { StoreSettingsPanel } from "../features/qfc/StoreSettingsPanel.js";
import { StoreItemReviewPanel } from "../features/qfc/StoreItemReviewPanel.js";
import { useQfc } from "../features/qfc/useQfc.js";
import { MenuHistoryPage } from "../features/menuHistory/MenuHistoryPage.js";
import { OurGroceriesSettingsPage } from "../features/ourGroceries/OurGroceriesSettingsPage.js";
import { listOurGroceriesLists, loadOurGroceriesStatus } from "../features/ourGroceries/api.js";

type ThemeMode = "light" | "dark";

const categories = recipeCategories;
const themeStorageKey = "grocery-getter-theme";
const dataScopeStorageKey = "grocery-getter-data-scope";

const views: Array<{ id: AppView; label: string; title: string; eyebrow: string; icon: typeof Shuffle }> = [
  { id: "planner", label: "Planner", title: "Planner", eyebrow: "Weekly menu workflow", icon: Shuffle },
  { id: "menu-history", label: "Menu History", title: "Menu History", eyebrow: "Saved weekly menus", icon: History },
  { id: "recipe-admin", label: "Recipes", title: "Recipes", eyebrow: "Recipe library", icon: Database },
  {
    id: "shopping-lists",
    label: "Shopping Lists",
    title: "Shopping Lists",
    eyebrow: "Reusable grocery templates",
    icon: ListChecks
  },
  { id: "qfc-api", label: "QFC Settings", title: "QFC Settings", eyebrow: "Integration settings", icon: Settings },
  {
    id: "ourgroceries",
    label: "OurGroceries",
    title: "OurGroceries Settings",
    eyebrow: "Integration settings",
    icon: ListChecks
  }
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
  const [ourGroceriesStatus, setOurGroceriesStatus] = useState<OurGroceriesStatus | null>(null);
  const [ourGroceriesLists, setOurGroceriesLists] = useState<OurGroceriesListSummary[]>([]);
  const invalidateStoreReviewRef = useRef<() => void>(() => undefined);
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
    saveShoppingItemApproval,
    saveShoppingItemToSource,
    savingSourceItemIds,
    setMealCount,
    setMessage,
    setShoppingList,
    shoppingList,
    sourceMetadataDirtyItemIds,
    updateCustomShoppingListSelection,
    updateOurGroceriesListSelection,
    updateMenuItem
  } = usePlanner({
    api,
    recipes,
    onSourcesChanged: async () => {
      await Promise.all([loadRecipes(), loadCustomShoppingLists()]);
    },
    onStoreReviewInvalidated: () => invalidateStoreReviewRef.current()
  });
  const {
    addReviewedStoreItemsToQfc,
    allowRealQfcCartMutation,
    forgetStoreItemPreference,
    invalidateStoreReview,
    loadSettings,
    openQfcCart,
    preferStoreBrands,
    previewStoreItems,
    qfcStatus,
    qfcSubmitProgress,
    removeStoreItemFromReview,
    reset: resetQfc,
    savingApprovalItemIds,
    searchingStoreItemIds,
    searchStoreItemsForReview,
    selectStoreItem,
    storeItemPreferences,
    storeItemReview,
    storeItemReviewMessage,
    updateRealQfcCartPermission,
    updateShoppingItemApproval,
    updateStoreBrandPreference,
    updateStoreItemQuantity
  } = useQfc({
    api,
    menuId: activeMenu?.id ?? null,
    shoppingList,
    setShoppingList,
    dirtyShoppingItemIds,
    sourceMetadataDirtyItemIds,
    saveDirtyShoppingItems,
    saveShoppingItemApproval,
    loadMenu,
    setPlannerMessage: setMessage
  });
  invalidateStoreReviewRef.current = invalidateStoreReview;

  async function loadRecipes() {
    setRecipes(await listRecipes(api));
  }

  async function loadCustomShoppingLists() {
    setCustomShoppingLists(await listShoppingLists(api));
  }

  async function loadOurGroceries() {
    const status = await loadOurGroceriesStatus(api);
    setOurGroceriesStatus(status);
    if (!status.connected) {
      setOurGroceriesLists([]);
      return;
    }
    try {
      setOurGroceriesLists(await listOurGroceriesLists(api));
    } catch {
      setOurGroceriesLists([]);
    }
  }

  useEffect(() => {
    void loadRecipes();
    void loadCustomShoppingLists();
    void loadOurGroceries();
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
    setOurGroceriesStatus(null);
    setOurGroceriesLists([]);
    resetPlanner(next === "sandbox" ? "Sandbox mode is active." : "");
    resetQfc();
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
                onClick={() => void Promise.all([loadRecipes(), loadCustomShoppingLists(), loadOurGroceries()])}
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

        {activeView === "ourgroceries" ? (
          <OurGroceriesSettingsPage
            api={api}
            dataScope={dataScope}
            status={ourGroceriesStatus}
            lists={ourGroceriesLists}
            refresh={loadOurGroceries}
          />
        ) : null}

        {activeView === "planner" ? (
          <PlannerPage
            menuBuilder={{
              recipes,
              customShoppingLists,
              ourGroceriesLists,
              mealCount,
              setMealCount,
              activeMenu,
              generateMenu,
              saveMenu,
              updateMenuItem,
              editRecipe: (recipeId) => navigate(recipeEditRoute(recipeId)),
              addMeal,
              removeMeal,
              updateCustomShoppingListSelection,
              updateOurGroceriesListSelection,
              editCustomShoppingList: (listId) => navigate(shoppingListEditRoute(listId)),
              aggregateIngredients
            }}
            shoppingListReview={{
              items: shoppingList,
              openSource: (source) => {
                if (source.type === "ourGroceries") {
                  window.open(source.webUrl, "_blank", "noopener,noreferrer");
                  return;
                }
                navigate(source.type === "recipe" ? recipeEditRoute(source.id) : shoppingListEditRoute(source.id));
              },
              savingApprovalItemIds,
              searchingStoreItemIds,
              savingSourceItemIds,
              updateApproval: updateShoppingItemApproval,
              saveToSource: saveShoppingItemToSource,
              clearItems: clearAggregatedIngredients,
              previewStoreItems,
              qfcSubmitProgress,
              message
            }}
            storeItemReview={(
              <StoreItemReviewPanel
                review={storeItemReview}
                allowRealQfcCartMutation={allowRealQfcCartMutation}
                addToCart={addReviewedStoreItemsToQfc}
                selectStoreItem={selectStoreItem}
                updateCartQuantity={updateStoreItemQuantity}
                searchStoreItems={searchStoreItemsForReview}
                removeStoreItem={removeStoreItemFromReview}
                openSource={(source) => {
                  if (source.type === "ourGroceries") {
                    window.open(source.webUrl, "_blank", "noopener,noreferrer");
                    return;
                  }
                  navigate(source.type === "recipe" ? recipeEditRoute(source.id) : shoppingListEditRoute(source.id));
                }}
                openQfcCart={openQfcCart}
                qfcSubmitProgress={qfcSubmitProgress}
                message={storeItemReviewMessage}
              />
            )}
          />
        ) : null}

        {activeView === "menu-history" ? (
          <MenuHistoryPage
            api={api}
            menuId={activeRoute.menuId ?? null}
            onOpenMenu={(menuId) => navigate(menuDetailRoute(menuId))}
            onBack={() => navigate(routeFromPathname("/menus"))}
            onDeleted={async () => {
              await loadLatestMenu();
              invalidateStoreReview();
              navigate(routeFromPathname("/menus"));
            }}
          />
        ) : null}
      </section>
    </main>
  );
}
