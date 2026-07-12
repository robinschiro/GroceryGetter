import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Check, Database, ExternalLink, Menu as MenuIcon, RefreshCw, Send, Settings, Shuffle, Trash2, X } from "lucide-react";
import "./styles.css";

type RecipeCategory = "entree" | "vegetable_side" | "starch_side";

type Recipe = {
  id: number;
  name: string;
  category: RecipeCategory;
  servings: number | null;
  notes: string;
  ingredients: RecipeIngredient[];
};

type RecipeIngredient = {
  id?: number;
  text: string;
  quantity: string;
  unit: string;
  item: string;
};

type Menu = {
  id: number;
  name: string;
  mealCount: number;
  status: string;
  items: MenuItem[];
};

type MenuItem = {
  id: number;
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

const emptyIngredient = (): RecipeIngredient => ({
  text: "",
  quantity: "",
  unit: "",
  item: ""
});

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
    const created = await api<{ id: number }>("/api/menus/generate", {
      method: "POST",
      body: JSON.stringify({ mealCount })
    });
    const menu = await api<Menu>(`/api/menus/${created.id}`);
    setActiveMenu(menu);
    setShoppingList([]);
  }

  async function loadMenu(id: number) {
    setActiveMenu(await api<Menu>(`/api/menus/${id}`));
  }

  async function updateMenuItem(menuItemId: number, recipeId: number) {
    await api(`/api/menu-items/${menuItemId}`, {
      method: "PUT",
      body: JSON.stringify({ recipeId })
    });
    if (activeMenu) {
      await loadMenu(activeMenu.id);
      setShoppingList([]);
    }
  }

  async function aggregateIngredients() {
    if (!activeMenu) return;
    await api(`/api/menus/${activeMenu.id}/aggregate`, { method: "POST" });
    setShoppingList(await api<ShoppingListItem[]>(`/api/menus/${activeMenu.id}/shopping-list`));
  }

  async function clearAggregatedIngredients() {
    if (!activeMenu) return;
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
    if (!activeMenu) return;
    setMessage("");
    setQfcSubmitProgress({
      phase: "checking",
      processedItems: 0,
      totalItems: shoppingList.filter((item) => item.approved).length,
      message: "Starting QFC cart submission..."
    });

    try {
      const started = await api<QfcSubmitJob>(`/api/menus/${activeMenu.id}/submit-to-qfc`, { method: "POST" });
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
            activeMenu={activeMenu}
            generateMenu={generateMenu}
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
  const [name, setName] = useState("");
  const [category, setCategory] = useState<RecipeCategory>("entree");
  const [servings, setServings] = useState("");
  const [notes, setNotes] = useState("");
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([emptyIngredient()]);
  const [error, setError] = useState("");

  function updateIngredient(index: number, patch: Partial<RecipeIngredient>) {
    setIngredients((current) => current.map((ingredient, i) => (i === index ? { ...ingredient, ...patch } : ingredient)));
  }

  async function saveRecipe() {
    setError("");
    try {
      await api("/api/recipes", {
        method: "POST",
        body: JSON.stringify({
          name,
          category,
          servings: servings ? Number(servings) : null,
          notes,
          ingredients: ingredients.filter((ingredient) => ingredient.text.trim() && ingredient.item.trim())
        })
      });
      setName("");
      setCategory("entree");
      setServings("");
      setNotes("");
      setIngredients([emptyIngredient()]);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save recipe.");
    }
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <Database size={18} />
        <h3>Recipe Admin</h3>
      </div>

      <div className="form-grid">
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Lemon chicken" />
        </label>
        <label>
          Category
          <select value={category} onChange={(event) => setCategory(event.target.value as RecipeCategory)}>
            {categories.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Servings
          <input value={servings} onChange={(event) => setServings(event.target.value)} inputMode="numeric" />
        </label>
      </div>

      <label>
        Notes
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
      </label>

      <div className="ingredient-editor">
        <div className="subhead">Ingredients</div>
        {ingredients.map((ingredient, index) => (
          <div className="ingredient-row" key={index}>
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
              onClick={() => setIngredients((current) => current.filter((_, i) => i !== index))}
              aria-label="Remove ingredient"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <button className="secondary" onClick={() => setIngredients((current) => [...current, emptyIngredient()])}>
          Add ingredient
        </button>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <div className="panel-actions">
        <button onClick={() => void saveRecipe()}>
          <Check size={17} />
          Save recipe
        </button>
      </div>

      <div className="recipe-list">
        {recipes.slice(0, 8).map((recipe) => (
          <div key={recipe.id} className="recipe-list-item">
            <strong>{recipe.name}</strong>
            <span>{categories.find((item) => item.value === recipe.category)?.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function MenuBuilder({
  recipes,
  mealCount,
  setMealCount,
  activeMenu,
  generateMenu,
  updateMenuItem,
  aggregateIngredients
}: {
  recipes: Recipe[];
  mealCount: number;
  setMealCount: (value: number) => void;
  activeMenu: Menu | null;
  generateMenu: () => Promise<void>;
  updateMenuItem: (menuItemId: number, recipeId: number) => Promise<void>;
  aggregateIngredients: () => Promise<void>;
}) {
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
                      onChange={(event) => item && void updateMenuItem(item.id, Number(event.target.value))}
                    >
                      {recipes
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
          <button onClick={() => void aggregateIngredients()}>
            <Settings size={17} />
            Aggregate ingredients
          </button>
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
