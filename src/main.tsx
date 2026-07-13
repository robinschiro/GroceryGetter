import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Database,
  ExternalLink,
  Menu as MenuIcon,
  RefreshCw,
  Send,
  Settings,
  Shuffle,
  Trash2,
  X
} from "lucide-react";
import "./styles.css";

type RecipeCategory = "entree" | "vegetable_side" | "starch_side";

type Recipe = {
  id: number;
  name: string;
  category: RecipeCategory;
  isTestData: boolean;
  servings: number | null;
  notes: string;
  ingredients: RecipeIngredient[];
};

type PlannerRecipeMode = "test" | "production";
type RecipeAdminTab = "create" | "manage";

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
  isTestData: boolean;
  status: string;
  items: MenuItem[];
};

type MenuItem = {
  id: number | null;
  mealNumber: number;
  slot: RecipeCategory;
  recipeId: number;
  recipeName: string;
};

type ShoppingListItem = {
  id: number;
  text: string;
  quantity: string;
  unit: string;
  item: string;
  sourceRecipeNames: string;
  approved: number;
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

type ProductCandidate = {
  productId: string;
  upc: string;
  description: string;
  brand: string;
  size: string;
  stockLevel: string;
  price: number | null;
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
    submittedItemCount: number;
    message: string;
    skipped?: unknown[];
  };
  error?: string;
};

type AppView = "recipe-admin" | "qfc-api" | "planner";

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

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const views: Array<{ id: AppView; label: string; title: string; eyebrow: string; icon: typeof Shuffle }> = [
  { id: "planner", label: "Planner", title: "Planner", eyebrow: "Weekly menu workflow", icon: Shuffle },
  { id: "recipe-admin", label: "Recipe Admin", title: "Recipe Admin", eyebrow: "Recipe library", icon: Database },
  { id: "qfc-api", label: "QFC API Setup", title: "QFC API Setup", eyebrow: "Integration settings", icon: Settings }
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init
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

function App() {
  const [activeView, setActiveView] = useState<AppView>("planner");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [activeMenu, setActiveMenu] = useState<Menu | null>(null);
  const [shoppingList, setShoppingList] = useState<ShoppingListItem[]>([]);
  const [mealCount, setMealCount] = useState(2);
  const [plannerRecipeMode, setPlannerRecipeMode] = useState<PlannerRecipeMode>("test");
  const [message, setMessage] = useState("");
  const [preferStoreBrands, setPreferStoreBrands] = useState(true);
  const [qfcStatus, setQfcStatus] = useState<QfcStatus | null>(null);
  const [qfcSubmitProgress, setQfcSubmitProgress] = useState<QfcSubmitProgress | null>(null);

  async function loadRecipes() {
    setRecipes((await api<Array<Recipe | null>>("/api/recipes")).filter(Boolean) as Recipe[]);
  }

  async function loadSettings() {
    const settings = await api<Record<string, string>>("/api/settings");
    setPreferStoreBrands(settings.preferStoreBrands === "true");
    setQfcStatus(await api<QfcStatus>("/api/qfc/status"));
  }

  useEffect(() => {
    void loadRecipes();
    void loadSettings();
  }, []);

  async function generateMenu() {
    setMessage("");
    try {
      const preview = await api<Menu>("/api/menus/preview", {
        method: "POST",
        body: JSON.stringify({ mealCount, includeTestData: plannerRecipeMode === "test" })
      });
      setActiveMenu(preview);
      setShoppingList([]);
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
          isTestData: activeMenu.isTestData,
          items: activeMenu.items.map(({ mealNumber, slot, recipeId }) => ({ mealNumber, slot, recipeId }))
        })
      });
      setActiveMenu(await api<Menu>(`/api/menus/${created.id}`));
      setShoppingList([]);
      setMessage("Menu saved.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to save menu.");
    }
  }

  function updatePlannerRecipeMode(next: PlannerRecipeMode) {
    setPlannerRecipeMode(next);
    setActiveMenu(null);
    setShoppingList([]);
    setMessage("");
  }

  async function loadMenu(id: number) {
    setActiveMenu(await api<Menu>(`/api/menus/${id}`));
  }

  async function updateMenuItem(menuItemId: number | null, mealNumber: number, slot: RecipeCategory, recipeId: number) {
    if (menuItemId === null) {
      const recipe = recipes.find((item) => item.id === recipeId);
      if (!activeMenu || !recipe) return;
      setActiveMenu({
        ...activeMenu,
        items: activeMenu.items.map((item) =>
          item.mealNumber === mealNumber && item.slot === slot
            ? { ...item, recipeId, recipeName: recipe.name }
            : item
        )
      });
      setShoppingList([]);
      return;
    }

    await api(`/api/menu-items/${menuItemId}`, {
      method: "PUT",
      body: JSON.stringify({ recipeId })
    });
    if (activeMenu?.id != null) {
      await loadMenu(activeMenu.id);
      setShoppingList([]);
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
  }

  async function clearAggregatedIngredients() {
    if (!activeMenu?.id) return;
    await api(`/api/menus/${activeMenu.id}/shopping-list`, { method: "DELETE" });
    setShoppingList([]);
    setMessage("");
  }

  async function saveShoppingItem(item: ShoppingListItem) {
    await api(`/api/shopping-list-items/${item.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...item, approved: Boolean(item.approved) })
    });
  }

  async function submitToQfc() {
    if (!activeMenu?.id) return;
    const menuId = activeMenu.id;
    setMessage("");
    setQfcSubmitProgress({
      phase: "checking",
      processedItems: 0,
      totalItems: shoppingList.filter((item) => item.approved).length,
      message: "Starting QFC cart submission..."
    });

    try {
      const started = await api<QfcSubmitJob>(`/api/menus/${menuId}/submit-to-qfc`, { method: "POST" });
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

      setMessage(job.result?.message ?? job.progress.message);
      await loadMenu(menuId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "QFC cart submission failed.");
    } finally {
      setQfcSubmitProgress(null);
    }
  }

  function openQfcCartToClear() {
    window.open(qfcCartUrl, "_blank", "noopener,noreferrer");
  }

  async function updateStoreBrandPreference(next: boolean) {
    setPreferStoreBrands(next);
    await api("/api/settings/preferStoreBrands", {
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

  const currentView = views.find((view) => view.id === activeView) ?? views[0];

  function selectView(view: AppView) {
    setActiveView(view);
    setIsMenuOpen(false);
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
              <h1>Grocery Getter</h1>
              <span className="eyebrow">{currentView.eyebrow}</span>
              <h2>{currentView.title}</h2>
            </div>
          </div>
          <button className="icon-button" onClick={() => void loadRecipes()} aria-label="Refresh recipes">
            <RefreshCw size={18} />
          </button>
        </header>

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
            <div className="menu-summary">
              {recipeCounts.map((category) => (
                <div key={category.value}>
                  <span>{category.label}</span>
                  <strong>{category.count}</strong>
                </div>
              ))}
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={preferStoreBrands}
                onChange={(event) => void updateStoreBrandPreference(event.target.checked)}
              />
              <span>Prefer QFC/Kroger store brands</span>
            </label>
          </div>
        ) : null}

        {activeView === "recipe-admin" ? (
          <RecipeAdmin recipes={recipes} onSaved={loadRecipes} />
        ) : null}

        {activeView === "qfc-api" ? (
          <QfcApiPanel status={qfcStatus} reloadStatus={loadSettings} />
        ) : null}

        {activeView === "planner" ? (
          <div className="grid planner-grid">
          <MenuBuilder
            recipes={recipes}
            mealCount={mealCount}
            setMealCount={setMealCount}
            plannerRecipeMode={plannerRecipeMode}
            setPlannerRecipeMode={updatePlannerRecipeMode}
            activeMenu={activeMenu}
            generateMenu={generateMenu}
            saveMenu={saveMenu}
            updateMenuItem={updateMenuItem}
            aggregateIngredients={aggregateIngredients}
          />
            <ShoppingListReview
              items={shoppingList}
              setItems={setShoppingList}
              saveItem={saveShoppingItem}
              clearItems={clearAggregatedIngredients}
              submitToQfc={submitToQfc}
              openQfcCartToClear={openQfcCartToClear}
              qfcSubmitProgress={qfcSubmitProgress}
              message={message}
            />
          </div>
        ) : null}
      </section>
    </main>
  );
}

function QfcApiPanel({
  status,
  reloadStatus
}: {
  status: QfcStatus | null;
  reloadStatus: () => Promise<void>;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [locationId, setLocationId] = useState("");
  const [serviceScopes, setServiceScopes] = useState("product.compact");
  const [customerScopes, setCustomerScopes] = useState("cart.basic:write");
  const [redirectUri, setRedirectUri] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [locations, setLocations] = useState<QfcLocation[]>([]);
  const [productTerm, setProductTerm] = useState("");
  const [products, setProducts] = useState<ProductCandidate[]>([]);
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
        body: JSON.stringify({
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

  async function findProducts() {
    setError("");
    try {
      const params = new URLSearchParams({ term: productTerm });
      const trimmedLocationId = locationId.trim();
      if (trimmedLocationId) {
        params.set("locationId", trimmedLocationId);
        await saveLocationId(trimmedLocationId);
      }
      setProducts(await api<ProductCandidate[]>(`/api/qfc/products?${params.toString()}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to search products.");
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
        <h3>QFC API Setup</h3>
      </div>

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
          <input value={clientId} onChange={(event) => setClientId(event.target.value)} />
        </label>
        <label>
          Client secret
          <input
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            placeholder={status?.hasClientSecret ? "Already saved" : ""}
            type="password"
          />
        </label>
        <label>
          Location ID
          <input value={locationId} onChange={(event) => setLocationId(event.target.value)} />
        </label>
        <label>
          Service scopes
          <input value={serviceScopes} onChange={(event) => setServiceScopes(event.target.value)} />
        </label>
        <label>
          Customer scopes
          <input value={customerScopes} onChange={(event) => setCustomerScopes(event.target.value)} />
        </label>
        <label className="wide-field">
          Redirect URI
          <input value={redirectUri} onChange={(event) => setRedirectUri(event.target.value)} />
        </label>
      </div>

      <div className="panel-actions">
        <button className="secondary" onClick={() => void reloadStatus()}>
          <RefreshCw size={17} />
          Refresh status
        </button>
        <button className="secondary" onClick={() => void refreshCustomerOAuth()}>
          <RefreshCw size={17} />
          Refresh OAuth
        </button>
        <button onClick={() => void startCustomerOAuth()}>
          <Send size={17} />
          Start customer OAuth
        </button>
        <button onClick={() => void saveSettings()}>
          <Check size={17} />
          Save QFC settings
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
            <input value={productTerm} onChange={(event) => setProductTerm(event.target.value)} placeholder="Search products" />
            <button className="secondary" onClick={() => void findProducts()}>Find products</button>
          </div>
          <div className="result-list">
            {products.map((product) => (
              <div className="product-row" key={`${product.productId}-${product.upc}`}>
                <strong>{product.description}</strong>
                <span>{[product.brand, product.size, product.stockLevel].filter(Boolean).join(" / ")}</span>
                <span>{product.price === null ? "" : `$${product.price.toFixed(2)}`}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}
    </section>
  );
}

function RecipeAdmin({ recipes, onSaved }: { recipes: Recipe[]; onSaved: () => Promise<void> }) {
  const [activeAdminTab, setActiveAdminTab] = useState<RecipeAdminTab>("create");
  const [editingRecipeId, setEditingRecipeId] = useState<number | null>(null);
  const editingRecipe = recipes.find((recipe) => recipe.id === editingRecipeId) ?? null;

  async function createRecipe(payload: RecipeFormPayload) {
    await api("/api/recipes", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await onSaved();
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
    setEditingRecipeId(null);
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <Database size={18} />
        <h3>Recipe Admin</h3>
      </div>

      <div className="sub-tabs" role="tablist" aria-label="Recipe admin sections">
        <button
          className={`sub-tab-button ${activeAdminTab === "create" ? "active" : ""}`}
          onClick={() => {
            setActiveAdminTab("create");
            setEditingRecipeId(null);
          }}
          role="tab"
          aria-selected={activeAdminTab === "create"}
          type="button"
        >
          Recipe Creation
        </button>
        <button
          className={`sub-tab-button ${activeAdminTab === "manage" ? "active" : ""}`}
          onClick={() => setActiveAdminTab("manage")}
          role="tab"
          aria-selected={activeAdminTab === "manage"}
          type="button"
        >
          Recipe Management
        </button>
      </div>

      {activeAdminTab === "create" ? (
        <RecipeForm mode="create" onSubmit={createRecipe} />
      ) : editingRecipe ? (
        <RecipeForm
          mode="edit"
          initialRecipe={editingRecipe}
          onCancel={() => setEditingRecipeId(null)}
          onSubmit={updateRecipe}
        />
      ) : (
        <RecipeManagementList recipes={recipes} onEdit={setEditingRecipeId} />
      )}
    </section>
  );
}

type RecipeFormPayload = {
  name: string;
  category: RecipeCategory;
  isTestData: boolean;
  servings: number | null;
  notes: string;
  ingredients: RecipeIngredient[];
};

function recipeFormInitialState(recipe?: Recipe) {
  return {
    name: recipe?.name ?? "",
    category: recipe?.category ?? "entree",
    isTestData: recipe?.isTestData ?? false,
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
  onSubmit
}: {
  mode: "create" | "edit";
  initialRecipe?: Recipe;
  onCancel?: () => void;
  onSubmit: (payload: RecipeFormPayload) => Promise<void>;
}) {
  const [form, setForm] = useState(() => recipeFormInitialState(initialRecipe));
  const [error, setError] = useState("");

  useEffect(() => {
    setForm(recipeFormInitialState(initialRecipe));
    setError("");
  }, [initialRecipe?.id]);

  function updateIngredient(index: number, patch: Partial<RecipeIngredient>) {
    setForm((current) => ({
      ...current,
      ingredients: current.ingredients.map((ingredient, i) => (i === index ? { ...ingredient, ...patch } : ingredient))
    }));
  }

  async function saveRecipe() {
    setError("");
    const savedIngredients = form.ingredients
      .map(normalizeRecipeIngredient)
      .filter((ingredient): ingredient is RecipeIngredient => ingredient !== null);

    try {
      await onSubmit({
        name: form.name,
        category: form.category,
        isTestData: form.isTestData,
        servings: form.servings ? Number(form.servings) : null,
        notes: form.notes,
        ingredients: savedIngredients
      });

      if (mode === "create") {
        setForm(recipeFormInitialState());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : mode === "create" ? "Unable to save recipe." : "Unable to update recipe.");
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
          checked={form.isTestData}
          onChange={(event) => setForm((current) => ({ ...current, isTestData: event.target.checked }))}
        />
        <span>Mark as test data</span>
      </label>

      <label>
        Notes
        <textarea
          value={form.notes}
          onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
          rows={3}
        />
      </label>

      <div className="ingredient-editor">
        <div className="subhead">Ingredients</div>
        {form.ingredients.map((ingredient, index) => (
          <div className="ingredient-row" key={`${ingredient.id ?? "new"}-${index}`}>
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
              value={ingredient.item}
              onChange={(event) => updateIngredient(index, { item: event.target.value })}
              placeholder="rice"
            />
            <input
              value={ingredient.text}
              onChange={(event) => updateIngredient(index, { text: event.target.value })}
              placeholder="2 cups rice"
            />
            <button
              className="icon-button"
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
          onClick={() => setForm((current) => ({ ...current, ingredients: [...current.ingredients, emptyIngredient()] }))}
          type="button"
        >
          Add ingredient
        </button>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <div className="panel-actions">
        <button onClick={() => void saveRecipe()} type="button">
          <Check size={17} />
          {mode === "create" ? "Save recipe" : "Update recipe"}
        </button>
      </div>
    </div>
  );
}

function RecipeManagementList({ recipes, onEdit }: { recipes: Recipe[]; onEdit: (recipeId: number) => void }) {
  const [managementPage, setManagementPage] = useState(0);
  const managementPageCount = Math.max(1, Math.ceil(recipes.length / recipeManagementPageSize));
  const currentManagementPage = Math.min(managementPage, managementPageCount - 1);
  const managementPageStart = currentManagementPage * recipeManagementPageSize;
  const visibleManagementRecipes = recipes.slice(managementPageStart, managementPageStart + recipeManagementPageSize);
  const managementRangeStart = recipes.length === 0 ? 0 : managementPageStart + 1;
  const managementRangeEnd = Math.min(recipes.length, managementPageStart + visibleManagementRecipes.length);

  useEffect(() => {
    setManagementPage((current) => Math.min(current, managementPageCount - 1));
  }, [managementPageCount]);

  return (
    <div className="tab-panel" role="tabpanel">
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

      {visibleManagementRecipes.length === 0 ? (
        <div className="empty-state">No recipes have been added yet.</div>
      ) : (
        <div className="recipe-list recipe-management-list">
          {visibleManagementRecipes.map((recipe) => (
            <button
              key={recipe.id}
              className="recipe-list-item recipe-management-item"
              onClick={() => onEdit(recipe.id)}
              type="button"
            >
              <div>
                <strong>{recipe.name}</strong>
                <span>{recipe.notes || "No notes"}</span>
              </div>
              <span>{categories.find((item) => item.value === recipe.category)?.label}</span>
              <span>{recipe.servings === null ? "Servings not set" : `${recipe.servings} servings`}</span>
              <span>{recipe.isTestData ? "Test" : "Non-test"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MenuBuilder({
  recipes,
  mealCount,
  setMealCount,
  plannerRecipeMode,
  setPlannerRecipeMode,
  activeMenu,
  generateMenu,
  saveMenu,
  updateMenuItem,
  aggregateIngredients
}: {
  recipes: Recipe[];
  mealCount: number;
  setMealCount: (value: number) => void;
  plannerRecipeMode: PlannerRecipeMode;
  setPlannerRecipeMode: (value: PlannerRecipeMode) => void;
  activeMenu: Menu | null;
  generateMenu: () => Promise<void>;
  saveMenu: () => Promise<void>;
  updateMenuItem: (
    menuItemId: number | null,
    mealNumber: number,
    slot: RecipeCategory,
    recipeId: number
  ) => Promise<void>;
  aggregateIngredients: () => Promise<void>;
}) {
  const plannerRecipes = recipes.filter((recipe) => recipe.isTestData === (plannerRecipeMode === "test"));

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
            onChange={(event) => setMealCount(Number(event.target.value))}
          />
        </label>
        <label>
          Recipes
          <select
            value={plannerRecipeMode}
            onChange={(event) => setPlannerRecipeMode(event.target.value as PlannerRecipeMode)}
          >
            <option value="test">Test recipes</option>
            <option value="production">Non-test recipes</option>
          </select>
        </label>
        <button onClick={() => void generateMenu()}>
          <Shuffle size={17} />
          Generate
        </button>
      </div>

      {activeMenu ? (
        <div className="menu-table">
          {Array.from({ length: activeMenu.mealCount }, (_, index) => index + 1).map((mealNumber) => (
            <div className="meal-block" key={mealNumber}>
              <strong>Meal {mealNumber}</strong>
              {categories.map((category) => {
                const item = activeMenu.items.find(
                  (menuItem) => menuItem.mealNumber === mealNumber && menuItem.slot === category.value
                );
                return (
                  <label key={category.value}>
                    {category.label}
                    <select
                      value={item?.recipeId ?? ""}
                      onChange={(event) =>
                        item && void updateMenuItem(item.id, mealNumber, category.value, Number(event.target.value))
                      }
                    >
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
        <div className="empty-state">Add recipes in all three categories, then generate a weekly menu.</div>
      )}
    </section>
  );
}

function ShoppingListReview({
  items,
  setItems,
  saveItem,
  clearItems,
  submitToQfc,
  openQfcCartToClear,
  qfcSubmitProgress,
  message
}: {
  items: ShoppingListItem[];
  setItems: (items: ShoppingListItem[]) => void;
  saveItem: (item: ShoppingListItem) => Promise<void>;
  clearItems: () => Promise<void>;
  submitToQfc: () => Promise<void>;
  openQfcCartToClear: () => void;
  qfcSubmitProgress: QfcSubmitProgress | null;
  message: string;
}) {
  function patchItem(id: number, patch: Partial<ShoppingListItem>) {
    setItems(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
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
            {items.map((item) => (
              <div className="shopping-row" key={item.id}>
                <label className="compact-checkbox">
                  <input
                    type="checkbox"
                    checked={Boolean(item.approved)}
                    onChange={(event) => patchItem(item.id, { approved: event.target.checked ? 1 : 0 })}
                    onBlur={() => void saveItem(item)}
                  />
                </label>
                <input value={item.quantity} onChange={(event) => patchItem(item.id, { quantity: event.target.value })} />
                <input value={item.unit} onChange={(event) => patchItem(item.id, { unit: event.target.value })} />
                <input value={item.item} onChange={(event) => patchItem(item.id, { item: event.target.value })} />
                <input value={item.text} onChange={(event) => patchItem(item.id, { text: event.target.value })} />
                <span>{item.sourceRecipeNames}</span>
                <button className="secondary" onClick={() => void saveItem(item)}>
                  Save
                </button>
              </div>
            ))}
          </div>
          <div className="panel-actions">
            <button className="secondary" onClick={() => void clearItems()}>
              <Trash2 size={17} />
              Clear aggregated ingredients
            </button>
            <button className="secondary" onClick={openQfcCartToClear}>
              <ExternalLink size={17} />
              Open cart on QFC
            </button>
            <button onClick={() => void submitToQfc()} disabled={Boolean(qfcSubmitProgress)}>
              <Send size={17} />
              {qfcSubmitProgress ? "Sending to QFC..." : "Send approved items to QFC"}
            </button>
          </div>
        </>
      ) : (
        <div className="empty-state">Aggregate a menu to review its grocery list.</div>
      )}

      {qfcSubmitProgress ? <QfcSubmitProgressBar progress={qfcSubmitProgress} /> : null}
      {message ? <div className="success">{message}</div> : null}
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
