import { Check, Pencil, Plus, Settings, Shuffle, Trash2 } from "lucide-react";
import type {
  CustomShoppingList,
  Menu,
  OurGroceriesListSummary,
  Recipe,
  RecipeCategory
} from "../../../shared/contracts/index.js";
import { recipeCategories } from "../../shared/recipeCategories.js";

export function MenuBuilder({
  recipes,
  customShoppingLists,
  ourGroceriesLists,
  mealCount,
  setMealCount,
  activeMenu,
  generateMenu,
  saveMenu,
  updateMenuItem,
  editRecipe,
  addMeal,
  removeMeal,
  updateCustomShoppingListSelection,
  updateOurGroceriesListSelection,
  editCustomShoppingList,
  aggregateIngredients
}: {
  recipes: Recipe[];
  customShoppingLists: CustomShoppingList[];
  ourGroceriesLists: OurGroceriesListSummary[];
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
  editRecipe: (recipeId: number) => void;
  addMeal: () => Promise<void>;
  removeMeal: (mealNumber: number) => Promise<void>;
  updateCustomShoppingListSelection: (listId: number, included: boolean) => Promise<void>;
  updateOurGroceriesListSelection: (list: OurGroceriesListSummary | null) => Promise<void>;
  editCustomShoppingList: (listId: number) => void;
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
              {recipeCategories.map((category) => {
                const item = activeMenu.items.find(
                  (menuItem) => menuItem.mealNumber === mealNumber && menuItem.slot === category.value
                );
                return (
                  <div className={`menu-slot menu-slot-${category.value}`} key={category.value}>
                    <label htmlFor={`meal-${mealNumber}-${category.value}`}>{category.label}</label>
                    <div className="planner-selector-row">
                      <select
                        id={`meal-${mealNumber}-${category.value}`}
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
                        {recipes
                          .filter((recipe) => recipe.category === category.value)
                          .map((recipe) => (
                            <option key={recipe.id} value={recipe.id}>
                              {recipe.name}
                            </option>
                          ))}
                      </select>
                      <button
                        className="icon-button secondary planner-edit-button"
                        type="button"
                        onClick={() => item?.recipeId && editRecipe(item.recipeId)}
                        disabled={!item?.recipeId}
                        aria-label={item?.recipeName ? `Edit ${item.recipeName}` : `No ${category.label.toLowerCase()} selected`}
                        title={item?.recipeName ? `Edit ${item.recipeName}` : `Select a ${category.label.toLowerCase()} to edit`}
                      >
                        <Pencil size={16} />
                      </button>
                    </div>
                  </div>
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
                  <div className="custom-list-option" key={list.id}>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={activeMenu.customShoppingListIds.includes(list.id)}
                        onChange={(event) =>
                          void updateCustomShoppingListSelection(list.id, event.target.checked)
                        }
                      />
                      <span>{list.name} ({list.items.length})</span>
                    </label>
                    <button
                      className="icon-button secondary planner-edit-button"
                      type="button"
                      onClick={() => editCustomShoppingList(list.id)}
                      aria-label={`Edit ${list.name}`}
                      title={`Edit ${list.name}`}
                    >
                      <Pencil size={16} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state compact">
                Add a custom shopping list from the Shopping Lists tab.
              </div>
            )}
          </div>
          <div className="custom-list-picker">
            <div>
              <strong>OurGroceries list</strong>
              <span>Include active items from one remote list when ingredients are aggregated.</span>
            </div>
            <label>
              List
              <select
                value={activeMenu.ourGroceriesList?.id ?? ""}
                onChange={(event) => {
                  const list = ourGroceriesLists.find((candidate) => candidate.id === event.target.value) ?? null;
                  void updateOurGroceriesListSelection(list);
                }}
              >
                <option value="">Do not include</option>
                {activeMenu.ourGroceriesList && !ourGroceriesLists.some((list) => list.id === activeMenu.ourGroceriesList?.id) ? (
                  <option value={activeMenu.ourGroceriesList.id}>
                    {activeMenu.ourGroceriesList.name} (currently unavailable)
                  </option>
                ) : null}
                {ourGroceriesLists.map((list) => (
                  <option key={list.id} value={list.id}>{list.name}</option>
                ))}
              </select>
            </label>
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
