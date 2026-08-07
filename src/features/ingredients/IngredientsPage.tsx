import { useEffect, useMemo, useState } from "react";
import { ChevronRight, LoaderCircle, PackageSearch, Search } from "lucide-react";
import type { IngredientSummary } from "../../../shared/contracts/index.js";
import type { ApiRequest } from "../../shared/apiClient.js";
import { listIngredients, setIngredientPantryStatus } from "./api.js";
import { recipeEditRoute, shoppingListEditRoute } from "../../shared/router.js";

type IngredientFilter = "all" | "pantry" | "not-pantry" | "remembered";

export function IngredientsPage({ api, forgetStoreItemPreference }: {
  api: ApiRequest;
  forgetStoreItemPreference: (provider: string, ingredientKey: string) => Promise<void>;
}) {
  const [ingredients, setIngredients] = useState<IngredientSummary[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<IngredientFilter>("all");
  const [loading, setLoading] = useState(true);
  const [savingKeys, setSavingKeys] = useState<Set<string>>(() => new Set());
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setIngredients(await listIngredients(api));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load ingredients.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [api]);

  const visibleIngredients = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return ingredients.filter((ingredient) => {
      const matchesFilter = filter === "all"
        || (filter === "pantry" && ingredient.isPantry)
        || (filter === "not-pantry" && !ingredient.isPantry)
        || (filter === "remembered" && ingredient.storeItemPreferences.length > 0);
      return matchesFilter && (!query
        || ingredient.ingredientName.toLocaleLowerCase().includes(query)
        || ingredient.storeItemPreferences.some((preference) =>
          preference.description.toLocaleLowerCase().includes(query)
        ));
    });
  }, [filter, ingredients, search]);

  async function togglePantry(ingredient: IngredientSummary) {
    if (savingKeys.has(ingredient.ingredientKey)) return;
    const next = !ingredient.isPantry;
    setError("");
    setIngredients((current) => current.map((candidate) =>
      candidate.ingredientKey === ingredient.ingredientKey
        ? { ...candidate, isPantry: next }
        : candidate
    ));
    setSavingKeys((current) => new Set(current).add(ingredient.ingredientKey));
    try {
      await setIngredientPantryStatus(api, ingredient.ingredientKey, ingredient.ingredientName, next);
    } catch (caught) {
      setIngredients((current) => current.map((candidate) =>
        candidate.ingredientKey === ingredient.ingredientKey
          ? { ...candidate, isPantry: ingredient.isPantry }
          : candidate
      ));
      setError(caught instanceof Error ? caught.message : "Unable to update pantry status.");
    } finally {
      setSavingKeys((current) => {
        const updated = new Set(current);
        updated.delete(ingredient.ingredientKey);
        return updated;
      });
    }
  }

  async function forgetPreference(provider: string, ingredientKey: string) {
    setError("");
    try {
      await forgetStoreItemPreference(provider, ingredientKey);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to forget the store item.");
    }
  }

  function toggleExpanded(ingredientKey: string) {
    setExpandedKeys((current) => {
      const updated = new Set(current);
      if (updated.has(ingredientKey)) updated.delete(ingredientKey);
      else updated.add(ingredientKey);
      return updated;
    });
  }

  return (
    <section className="panel ingredients-page">
      <div className="panel-heading">
        <PackageSearch size={18} />
        <div>
          <h3>Ingredients</h3>
          <p>Manage pantry ingredients and remembered store-item matches.</p>
        </div>
      </div>
      <div className="ingredient-controls">
        <label className="ingredient-search">
          <span>Search ingredients</span>
          <div className="recipe-search-input">
            <Search aria-hidden="true" size={16} />
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
              placeholder="Search ingredients or store items" />
          </div>
        </label>
        <label>
          <span>Filter</span>
          <select aria-label="Ingredient filter" value={filter}
            onChange={(event) => setFilter(event.target.value as IngredientFilter)}>
            <option value="all">All ingredients</option>
            <option value="pantry">Pantry</option>
            <option value="not-pantry">Not pantry</option>
            <option value="remembered">Remembered store item</option>
          </select>
        </label>
      </div>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {loading ? (
        <div className="empty-state"><LoaderCircle className="store-search-spinner" size={18} /> Loading ingredients...</div>
      ) : visibleIngredients.length ? (
        <div className="ingredient-preference-list">
          {visibleIngredients.map((ingredient) => {
            const saving = savingKeys.has(ingredient.ingredientKey);
            const expanded = expandedKeys.has(ingredient.ingredientKey);
            const sourceParts = [
              ingredient.recipeCount ? `${ingredient.recipeCount} recipe${ingredient.recipeCount === 1 ? "" : "s"}` : "",
              ingredient.shoppingListCount ? `${ingredient.shoppingListCount} shopping list${ingredient.shoppingListCount === 1 ? "" : "s"}` : ""
            ].filter(Boolean);
            return (
              <article className="ingredient-preference-row" key={ingredient.ingredientKey}>
                <div className="ingredient-preference-name">
                  <strong>{ingredient.ingredientName}</strong>
                  {sourceParts.length ? (
                    <button
                      className="ingredient-expand-button"
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => toggleExpanded(ingredient.ingredientKey)}
                    >
                      <ChevronRight aria-hidden="true" size={15} />
                      Used in {sourceParts.join(" and ")}
                    </button>
                  ) : <span>Saved preference</span>}
                </div>
                <label className="ingredient-pantry-toggle">
                  <input type="checkbox" checked={ingredient.isPantry} disabled={saving}
                    onChange={() => void togglePantry(ingredient)} />
                  <span>
                    <strong>Pantry</strong>
                    <small>{ingredient.isPantry
                      ? "Assumed on hand unless active in OurGroceries."
                      : "Include normally during aggregation."}</small>
                  </span>
                  {saving ? <LoaderCircle className="store-search-spinner" size={16} aria-label="Saving pantry status" /> : null}
                </label>
                <div className="ingredient-store-items">
                  <span className="subhead">Remembered store item</span>
                  {ingredient.storeItemPreferences.length ? ingredient.storeItemPreferences.map((preference) => (
                    <div className="ingredient-store-item" key={`${preference.provider}-${preference.ingredientKey}`}>
                      <div>
                        <strong>{preference.description}</strong>
                        <span>{[preference.brand, preference.size].filter(Boolean).join(" · ")}</span>
                      </div>
                      <button className="secondary" type="button"
                        onClick={() => void forgetPreference(preference.provider, preference.ingredientKey)}>
                        Forget item
                      </button>
                    </div>
                  )) : <span>None</span>}
                </div>
                {expanded ? (
                  <div className="ingredient-source-details">
                    <span className="subhead">Used in</span>
                    {ingredient.sources.length ? (
                      <ul>
                        {ingredient.sources.map((source) => (
                          <li key={`${source.type}-${source.id}`}>
                            <a href={source.type === "recipe"
                              ? recipeEditRoute(source.id).path
                              : shoppingListEditRoute(source.id).path}>
                              {source.name}
                            </a>
                            <span>{source.type === "recipe" ? "Recipe" : "Shopping list"}</span>
                          </li>
                        ))}
                      </ul>
                    ) : <span>No current recipe or shopping-list sources.</span>}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : <div className="empty-state">No ingredients match these filters.</div>}
    </section>
  );
}
