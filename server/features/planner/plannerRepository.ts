import type { GroceryDatabase } from "../../infrastructure/database/database.js";
import type {
  DataScope,
  Menu,
  RecipeCategory,
  ShoppingListItem
} from "../../../shared/contracts/index.js";

export type PlannerRecipe = {
  id: number;
  name: string;
  category: RecipeCategory;
  dataScope: DataScope;
};

export type MenuItemInput = {
  mealNumber: number;
  slot: RecipeCategory;
  recipeId: number | null;
};

type MenuRow = Omit<Menu, "items" | "customShoppingListIds">;

export function createPlannerRepository(database: GroceryDatabase) {
  function getMenu(menuId: number, dataScope: DataScope): Menu | null {
    const menu = database.queryOne<MenuRow>(
      `SELECT
        id,
        name,
        meal_count AS mealCount,
        data_scope AS dataScope,
        status,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM menus WHERE id = ? AND data_scope = ?`,
      [menuId, dataScope]
    );
    if (!menu) {
      return null;
    }

    const items = database.queryAll(
      `SELECT
        menu_items.id,
        menu_items.meal_number AS mealNumber,
        menu_items.slot,
        recipes.id AS recipeId,
        recipes.name AS recipeName
      FROM menu_items
      LEFT JOIN recipes ON recipes.id = menu_items.recipe_id
      WHERE menu_items.menu_id = ?
      ORDER BY menu_items.meal_number, menu_items.slot`,
      [menuId]
    ) as Menu["items"];
    const customShoppingListIds = database.queryAll<{ customShoppingListId: number }>(
      `SELECT custom_shopping_list_id AS customShoppingListId
      FROM menu_custom_shopping_lists
      WHERE menu_id = ?
      ORDER BY custom_shopping_list_id`,
      [menuId]
    ).map((row) => row.customShoppingListId);

    return { ...menu, items, customShoppingListIds };
  }

  return {
    getMenu,

    listMenus(dataScope: DataScope) {
      return database.queryAll<{
        id: number;
        name: string;
        mealCount: number;
        status: string;
        createdAt: string;
        updatedAt: string;
      }>(
        `SELECT
          id,
          name,
          meal_count AS mealCount,
          status,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM menus
        WHERE data_scope = ?
        ORDER BY created_at DESC, id DESC`,
        [dataScope]
      );
    },

    listGenerationRecipes(dataScope: DataScope) {
      return database.queryAll(
        `SELECT id, name, category, data_scope AS dataScope
        FROM recipes
        WHERE data_scope = ? AND include_in_menu_generation = 1`,
        [dataScope]
      ) as PlannerRecipe[];
    },

    listDefaultShoppingListIds(dataScope: DataScope) {
      return database.queryAll<{ id: number }>(
        `SELECT id
        FROM custom_shopping_lists
        WHERE include_in_menu_by_default = 1 AND data_scope = ?
        ORDER BY name COLLATE NOCASE, id`,
        [dataScope]
      ).map((list) => list.id);
    },

    countShoppingLists(ids: number[], dataScope: DataScope) {
      if (!ids.length) return 0;
      return database.queryOne<{ count: number }>(
        `SELECT COUNT(*) AS count
        FROM custom_shopping_lists
        WHERE data_scope = ? AND id IN (${ids.map(() => "?").join(", ")})`,
        [dataScope, ...ids]
      )?.count ?? 0;
    },

    getRecipeCategory(recipeId: number, dataScope: DataScope) {
      return database.queryOne<{ category: RecipeCategory }>(
        "SELECT category FROM recipes WHERE id = ? AND data_scope = ?",
        [recipeId, dataScope]
      )?.category ?? null;
    },

    createMenu(
      name: string,
      mealCount: number,
      items: MenuItemInput[],
      shoppingListIds: number[],
      dataScope: DataScope
    ) {
      return database.transaction(() => {
        const menuId = database.insert(
          "INSERT INTO menus (name, meal_count, data_scope) VALUES (?, ?, ?)",
          [name, mealCount, dataScope]
        );
        for (const item of items) {
          database.run(
            "INSERT INTO menu_items (menu_id, meal_number, slot, recipe_id) VALUES (?, ?, ?, ?)",
            [menuId, item.mealNumber, item.slot, item.recipeId]
          );
        }
        for (const shoppingListId of shoppingListIds) {
          database.run(
            "INSERT INTO menu_custom_shopping_lists (menu_id, custom_shopping_list_id) VALUES (?, ?)",
            [menuId, shoppingListId]
          );
        }
        return menuId;
      });
    },

    getLatestMenu(dataScope: DataScope) {
      const latest = database.queryOne<{ id: number }>(
        "SELECT id FROM menus WHERE data_scope = ? ORDER BY created_at DESC, id DESC LIMIT 1",
        [dataScope]
      );
      return latest ? getMenu(latest.id, dataScope) : null;
    },

    deleteMenu(menuId: number, dataScope: DataScope) {
      database.transaction(() => {
        database.run(
          "DELETE FROM menus WHERE id = ? AND data_scope = ?",
          [menuId, dataScope]
        );
      });
    },

    addMeal(menuId: number, mealNumber: number, items: MenuItemInput[], dataScope: DataScope) {
      database.transaction(() => {
        database.run("DELETE FROM menu_shopping_list_items WHERE menu_id = ?", [menuId]);
        for (const item of items) {
          database.run(
            "INSERT INTO menu_items (menu_id, meal_number, slot, recipe_id) VALUES (?, ?, ?, ?)",
            [menuId, mealNumber, item.slot, item.recipeId]
          );
        }
        database.run(
          "UPDATE menus SET meal_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          [mealNumber, menuId]
        );
      });
      return getMenu(menuId, dataScope);
    },

    removeMeal(menuId: number, mealNumber: number, dataScope: DataScope) {
      database.transaction(() => {
        database.run("DELETE FROM menu_shopping_list_items WHERE menu_id = ?", [menuId]);
        database.run(
          "DELETE FROM menu_items WHERE menu_id = ? AND meal_number = ?",
          [menuId, mealNumber]
        );
        database.run(
          "UPDATE menu_items SET meal_number = meal_number - 1 WHERE menu_id = ? AND meal_number > ?",
          [menuId, mealNumber]
        );
        database.run(
          "UPDATE menus SET meal_count = meal_count - 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          [menuId]
        );
      });
      return getMenu(menuId, dataScope);
    },

    getMenuItemSlot(menuItemId: string, dataScope: DataScope) {
      return database.queryOne<{ slot: RecipeCategory }>(
        `SELECT menu_items.slot
        FROM menu_items
        JOIN menus ON menus.id = menu_items.menu_id
        WHERE menu_items.id = ? AND menus.data_scope = ?`,
        [menuItemId, dataScope]
      )?.slot ?? null;
    },

    updateMenuItem(menuItemId: string, recipeId: number | null) {
      database.run("UPDATE menu_items SET recipe_id = ? WHERE id = ?", [recipeId, menuItemId]);
      database.save();
    },

    replaceShoppingLists(menuId: number, ids: number[]) {
      database.transaction(() => {
        database.run("DELETE FROM menu_custom_shopping_lists WHERE menu_id = ?", [menuId]);
        for (const id of ids) {
          database.run(
            "INSERT INTO menu_custom_shopping_lists (menu_id, custom_shopping_list_id) VALUES (?, ?)",
            [menuId, id]
          );
        }
        database.run("UPDATE menus SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [menuId]);
      });
    },

    getShoppingListItems(menuId: number, dataScope: DataScope): ShoppingListItem[] {
      const items = database.queryAll<Omit<ShoppingListItem, "sourceTargets">>(
        `SELECT
          menu_shopping_list_items.id,
          menu_shopping_list_items.text,
          menu_shopping_list_items.quantity,
          menu_shopping_list_items.unit,
          menu_shopping_list_items.item,
          menu_shopping_list_items.source_names AS sourceNames,
          menu_shopping_list_items.approved,
          (
            SELECT COUNT(*)
            FROM menu_shopping_list_item_recipe_sources
            JOIN menu_items
              ON menu_items.id = menu_shopping_list_item_recipe_sources.menu_item_id
              AND menu_items.menu_id = menu_shopping_list_items.menu_id
            JOIN recipe_ingredients
              ON recipe_ingredients.id = menu_shopping_list_item_recipe_sources.recipe_ingredient_id
              AND recipe_ingredients.recipe_id = menu_items.recipe_id
            WHERE menu_shopping_list_item_recipe_sources.menu_shopping_list_item_id =
              menu_shopping_list_items.id
          ) + (
            SELECT COUNT(*)
            FROM menu_shopping_list_item_custom_sources
            JOIN custom_shopping_list_items
              ON custom_shopping_list_items.id =
                menu_shopping_list_item_custom_sources.custom_shopping_list_item_id
            WHERE menu_shopping_list_item_custom_sources.menu_shopping_list_item_id =
              menu_shopping_list_items.id
          ) AS sourceOccurrenceCount,
          CASE WHEN (
            SELECT COUNT(*)
            FROM menu_shopping_list_item_recipe_sources
            JOIN menu_items
              ON menu_items.id = menu_shopping_list_item_recipe_sources.menu_item_id
              AND menu_items.menu_id = menu_shopping_list_items.menu_id
            JOIN recipe_ingredients
              ON recipe_ingredients.id = menu_shopping_list_item_recipe_sources.recipe_ingredient_id
              AND recipe_ingredients.recipe_id = menu_items.recipe_id
            WHERE menu_shopping_list_item_recipe_sources.menu_shopping_list_item_id =
              menu_shopping_list_items.id
          ) + (
            SELECT COUNT(*)
            FROM menu_shopping_list_item_custom_sources
            JOIN custom_shopping_list_items
              ON custom_shopping_list_items.id =
                menu_shopping_list_item_custom_sources.custom_shopping_list_item_id
            WHERE menu_shopping_list_item_custom_sources.menu_shopping_list_item_id =
              menu_shopping_list_items.id
          ) = 1 THEN 1 ELSE 0 END AS canPersistToSource
        FROM menu_shopping_list_items
        JOIN menus ON menus.id = menu_shopping_list_items.menu_id
        WHERE menu_shopping_list_items.menu_id = ? AND menus.data_scope = ?
        ORDER BY menu_shopping_list_items.sort_order, menu_shopping_list_items.id`,
        [menuId, dataScope]
      );
      const recipeSources = database.queryAll<{
        shoppingListItemId: number;
        id: number;
        name: string;
      }>(
        `SELECT DISTINCT
          menu_shopping_list_item_recipe_sources.menu_shopping_list_item_id AS shoppingListItemId,
          recipes.id,
          recipes.name
        FROM menu_shopping_list_item_recipe_sources
        JOIN menu_shopping_list_items
          ON menu_shopping_list_items.id =
            menu_shopping_list_item_recipe_sources.menu_shopping_list_item_id
          AND menu_shopping_list_items.menu_id = ?
        JOIN menu_items
          ON menu_items.id = menu_shopping_list_item_recipe_sources.menu_item_id
          AND menu_items.menu_id = menu_shopping_list_items.menu_id
        JOIN recipes ON recipes.id = menu_items.recipe_id
        WHERE recipes.data_scope = ?
        ORDER BY recipes.name COLLATE NOCASE, recipes.id`,
        [menuId, dataScope]
      );
      const customSources = database.queryAll<{
        shoppingListItemId: number;
        id: number;
        name: string;
      }>(
        `SELECT DISTINCT
          menu_shopping_list_item_custom_sources.menu_shopping_list_item_id AS shoppingListItemId,
          custom_shopping_lists.id,
          custom_shopping_lists.name
        FROM menu_shopping_list_item_custom_sources
        JOIN menu_shopping_list_items
          ON menu_shopping_list_items.id =
            menu_shopping_list_item_custom_sources.menu_shopping_list_item_id
          AND menu_shopping_list_items.menu_id = ?
        JOIN custom_shopping_list_items
          ON custom_shopping_list_items.id =
            menu_shopping_list_item_custom_sources.custom_shopping_list_item_id
        JOIN custom_shopping_lists
          ON custom_shopping_lists.id = custom_shopping_list_items.custom_shopping_list_id
        WHERE custom_shopping_lists.data_scope = ?
        ORDER BY custom_shopping_lists.name COLLATE NOCASE, custom_shopping_lists.id`,
        [menuId, dataScope]
      );

      return items.map((item) => ({
        ...item,
        sourceTargets: [
          ...recipeSources
            .filter((source) => source.shoppingListItemId === item.id)
            .map((source) => ({ type: "recipe" as const, id: source.id, name: source.name })),
          ...customSources
            .filter((source) => source.shoppingListItemId === item.id)
            .map((source) => ({
              type: "shoppingList" as const,
              id: source.id,
              name: source.name
            }))
        ]
      }));
    }
  };
}

export type PlannerRepository = ReturnType<typeof createPlannerRepository>;
