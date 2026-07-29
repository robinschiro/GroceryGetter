import type { GroceryDatabase } from "../../db.js";
import type { DataScope, ShoppingListItem } from "../../../shared/contracts/index.js";

export function createPlannerRepository(database: GroceryDatabase) {
  return {
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
