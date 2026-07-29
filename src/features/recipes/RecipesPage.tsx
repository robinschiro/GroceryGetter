import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Database,
  Search,
  Trash2,
  X
} from "lucide-react";
import type {
  Recipe,
  RecipeCategory,
  RecipeIngredient,
  RecipeInput
} from "../../../shared/contracts/index.js";
import type { RecipeAdminTab } from "../../shared/router.js";
import { recipeEditRoute } from "../../shared/router.js";
import type { ApiRequest } from "../../shared/apiClient.js";
import {
  recipeCategories,
  type RecipeCategoryCount
} from "../../shared/recipeCategories.js";
import {
  createRecipe,
  deleteRecipe,
  setRecipeMenuGeneration,
  updateRecipe
} from "./api.js";

type RecipesPageProps = {
  api: ApiRequest;
  activeTab: RecipeAdminTab;
  editingRecipeId: number | null;
  onEdit: (recipeId: number) => void;
  onExitEdit: () => void;
  onTabChange: (tab: RecipeAdminTab) => void;
  recipes: Recipe[];
  recipeCounts: RecipeCategoryCount[];
  onSaved: () => Promise<void>;
};

export function RecipesPage({
  api,
  activeTab,
  editingRecipeId,
  onEdit,
  onExitEdit,
  onTabChange,
  recipes,
  recipeCounts,
  onSaved
}: RecipesPageProps) {
  const editingRecipe = recipes.find((recipe) => recipe.id === editingRecipeId) ?? null;

  async function create(payload: RecipeInput) {
    const created = await createRecipe(api, payload);
    await onSaved();
    return created;
  }

  async function update(payload: RecipeInput) {
    if (!editingRecipe) return;
    await updateRecipe(api, editingRecipe.id, payload);
    await onSaved();
  }

  async function remove() {
    if (!editingRecipe) return;
    await deleteRecipe(api, editingRecipe.id);
    await onSaved();
    onExitEdit();
  }

  async function toggleGeneration(recipe: Recipe) {
    await setRecipeMenuGeneration(api, recipe.id, !recipe.includeInMenuGeneration);
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
        <RecipeForm mode="create" onSubmit={create} />
      ) : editingRecipe ? (
        <RecipeForm
          mode="edit"
          initialRecipe={editingRecipe}
          onCancel={onExitEdit}
          onDelete={remove}
          onSubmit={update}
        />
      ) : (
        <RecipeManagementList
          recipes={recipes}
          recipeCounts={recipeCounts}
          onEdit={onEdit}
          onToggleGeneration={toggleGeneration}
        />
      )}
    </section>
  );
}

function emptyIngredient(): RecipeIngredient {
  return { text: "", quantity: "", unit: "", item: "" };
}

function normalizeIngredient(ingredient: RecipeIngredient): RecipeIngredient | null {
  const quantity = ingredient.quantity.trim();
  const unit = ingredient.unit.trim();
  const item = ingredient.item.trim();
  if (!item) return null;
  return {
    ...ingredient,
    text: ingredient.text.trim() || [quantity, unit, item].filter(Boolean).join(" "),
    quantity,
    unit,
    item
  };
}

function initialForm(recipe?: Recipe) {
  return {
    name: recipe?.name ?? "",
    category: recipe?.category ?? "entree" as RecipeCategory,
    includeInMenuGeneration: recipe?.includeInMenuGeneration ?? true,
    servings: recipe?.servings == null ? "" : String(recipe.servings),
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
  onSubmit: (payload: RecipeInput) => Promise<Recipe | void>;
}) {
  const [form, setForm] = useState(() => initialForm(initialRecipe));
  const [error, setError] = useState("");
  const [createdRecipe, setCreatedRecipe] = useState<Recipe | null>(null);
  const [updatedRecipeName, setUpdatedRecipeName] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const ingredientEditorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setForm(initialForm(initialRecipe));
    setError("");
    setCreatedRecipe(null);
    setUpdatedRecipeName(null);
  }, [initialRecipe?.id]);

  function updateIngredient(index: number, patch: Partial<RecipeIngredient>) {
    setForm((current) => ({
      ...current,
      ingredients: current.ingredients.map((ingredient, currentIndex) =>
        currentIndex === index ? { ...ingredient, ...patch } : ingredient
      )
    }));
  }

  function addIngredient() {
    const activeElement = document.activeElement;
    setForm((current) => ({
      ...current,
      ingredients: [...current.ingredients, emptyIngredient()]
    }));
    window.requestAnimationFrame(() => {
      if (document.activeElement !== activeElement) return;
      const inputs = ingredientEditorRef.current?.querySelectorAll<HTMLInputElement>(
        ".ingredient-item-input"
      );
      inputs?.[inputs.length - 1]?.focus();
    });
  }

  async function save() {
    setError("");
    setCreatedRecipe(null);
    setUpdatedRecipeName(null);
    const ingredients = form.ingredients
      .map(normalizeIngredient)
      .filter((ingredient): ingredient is RecipeIngredient => ingredient !== null);
    try {
      setIsSubmitting(true);
      const recipe = await onSubmit({
        name: form.name,
        category: form.category,
        includeInMenuGeneration: form.includeInMenuGeneration,
        servings: form.servings ? Number(form.servings) : null,
        notes: form.notes,
        ingredients
      });
      if (mode === "create") {
        if (recipe) setCreatedRecipe(recipe);
        setForm(initialForm());
      } else {
        setUpdatedRecipeName(form.name.trim());
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : mode === "create"
            ? "Unable to save recipe."
            : "Unable to update recipe."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function remove() {
    if (!onDelete || !initialRecipe) return;
    if (!window.confirm(`Delete “${initialRecipe.name}”? This action cannot be undone.`)) return;
    setError("");
    setIsSubmitting(true);
    try {
      await onDelete();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete recipe.");
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
            onChange={(event) => setForm((current) => ({
              ...current,
              category: event.target.value as RecipeCategory
            }))}
          >
            {recipeCategories.map((category) => (
              <option key={category.value} value={category.value}>{category.label}</option>
            ))}
          </select>
        </label>
        <label>
          Servings
          <input
            value={form.servings}
            onChange={(event) => setForm((current) => ({
              ...current,
              servings: event.target.value
            }))}
            inputMode="numeric"
          />
        </label>
      </div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={form.includeInMenuGeneration}
          onChange={(event) => setForm((current) => ({
            ...current,
            includeInMenuGeneration: event.target.checked
          }))}
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
              onClick={() => setForm((current) => ({
                ...current,
                ingredients: current.ingredients.filter((_, itemIndex) => itemIndex !== index)
              }))}
              aria-label="Remove ingredient"
              type="button"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <button className="secondary" onClick={addIngredient} type="button">
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
      {updatedRecipeName ? (
        <div className="success" role="status">
          Recipe “{updatedRecipeName}” was updated successfully.
        </div>
      ) : null}
      <div className="panel-actions">
        {mode === "edit" ? (
          <button
            className="danger delete-recipe-button"
            aria-busy={isSubmitting}
            disabled={isSubmitting}
            onClick={() => void remove()}
            type="button"
          >
            <Trash2 size={17} />
            Delete recipe
          </button>
        ) : null}
        <button
          aria-busy={isSubmitting}
          disabled={isSubmitting}
          onClick={() => void save()}
          type="button"
        >
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
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<RecipeCategory | "all">("all");
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const filtered = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase();
    return recipes.filter((recipe) =>
      (category === "all" || recipe.category === category)
      && (!normalized || recipe.name.toLocaleLowerCase().includes(normalized))
    );
  }, [category, recipes, search]);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * pageSize;
  const visible = filtered.slice(start, start + pageSize);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  async function toggle(recipe: Recipe) {
    setError("");
    setUpdatingId(recipe.id);
    try {
      await onToggleGeneration(recipe);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update menu generation.");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="tab-panel" role="tabpanel">
      <div className="recipe-count-summary" aria-label="Recipe category counts">
        {recipeCounts.map((item) => (
          <div key={item.value}><span>{item.label}</span><strong>{item.count}</strong></div>
        ))}
      </div>
      <div className="recipe-management-filters" aria-label="Recipe filters">
        <label className="recipe-search-filter">
          <span>Search recipes</span>
          <div className="recipe-search-input">
            <Search aria-hidden="true" size={16} />
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              placeholder="Search by recipe name"
            />
          </div>
        </label>
        <label>
          <span>Category</span>
          <select
            value={category}
            onChange={(event) => {
              setCategory(event.target.value as RecipeCategory | "all");
              setPage(0);
            }}
          >
            <option value="all">All categories</option>
            {recipeCategories.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="recipe-management-header">
        <div>
          <div className="subhead">Recipes</div>
          <span>
            Showing {filtered.length ? start + 1 : 0}-{Math.min(filtered.length, start + visible.length)}
            {" "}of {filtered.length}
          </span>
        </div>
        <div className="pagination-controls" aria-label="Recipe list pagination">
          <button
            className="icon-button secondary"
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            disabled={currentPage === 0}
            aria-label="Previous recipe page"
            type="button"
          >
            <ChevronLeft size={16} />
          </button>
          <span>Page {currentPage + 1} of {pageCount}</span>
          <button
            className="icon-button secondary"
            onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
            disabled={currentPage >= pageCount - 1}
            aria-label="Next recipe page"
            type="button"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      {error ? <div className="error">{error}</div> : null}
      {visible.length === 0 ? (
        <div className="empty-state">
          {recipes.length === 0
            ? "No recipes have been added yet."
            : "No recipes match these filters."}
        </div>
      ) : (
        <div className="recipe-list recipe-management-list">
          {visible.map((recipe) => (
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
                  {recipeCategories.find((item) => item.value === recipe.category)?.label}
                </span>
                <span className="recipe-meta-chip">
                  {recipe.servings === null ? "Servings not set" : `${recipe.servings} servings`}
                </span>
                <button
                  className={`recipe-meta-chip recipe-status-chip recipe-generation-toggle ${
                    recipe.includeInMenuGeneration ? "enabled" : ""
                  }`}
                  aria-busy={updatingId === recipe.id}
                  aria-label={`${
                    recipe.includeInMenuGeneration ? "Disable" : "Enable"
                  } menu generation for ${recipe.name}`}
                  aria-pressed={recipe.includeInMenuGeneration}
                  disabled={updatingId !== null}
                  onClick={() => void toggle(recipe)}
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
