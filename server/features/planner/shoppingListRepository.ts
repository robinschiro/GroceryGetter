import type { GroceryDatabase } from "../../infrastructure/database/database.js";
import type { ShoppingListItem } from "../../../shared/contracts/index.js";

export type AggregateSource = {
  sourceType: "recipe" | "custom" | "ourGroceries";
  menuItemId: number | null;
  recipeIngredientId: number | null;
  customShoppingListItemId: number | null;
  ourGroceriesItemId: string | null;
  text: string;
  quantity: string;
  unit: string;
  item: string;
  sourceName: string;
};

export type AggregatedGroup = {
  item: string;
  quantity: string;
  sourceNames: string;
  sources: AggregateSource[];
};

export type OurGroceriesSnapshotItem = {
  remoteItemId: string;
  text: string;
  item: string;
  sortOrder: number;
};

export type ShoppingItemUpdate = Pick<
  ShoppingListItem,
  "id" | "text" | "quantity" | "unit" | "item" | "approved"
>;

export function createShoppingListWorkflowRepository(database: GroceryDatabase) {
  return {
    getAggregateSources(menuId: number) {
      const recipeSources = database.queryAll(
        `SELECT
          'recipe' AS sourceType,
          menu_items.id AS menuItemId,
          recipe_ingredients.id AS recipeIngredientId,
          NULL AS customShoppingListItemId,
          NULL AS ourGroceriesItemId,
          recipe_ingredients.text,
          recipe_ingredients.quantity,
          recipe_ingredients.unit,
          recipe_ingredients.item,
          recipes.name AS sourceName
        FROM menu_items
        JOIN recipe_ingredients ON recipe_ingredients.recipe_id = menu_items.recipe_id
        JOIN recipes ON recipes.id = menu_items.recipe_id
        WHERE menu_items.menu_id = ?
        ORDER BY recipes.name, recipe_ingredients.sort_order`,
        [menuId]
      ) as AggregateSource[];
      const customSources = database.queryAll(
        `SELECT
          'custom' AS sourceType,
          NULL AS menuItemId,
          NULL AS recipeIngredientId,
          custom_shopping_list_items.id AS customShoppingListItemId,
          NULL AS ourGroceriesItemId,
          custom_shopping_list_items.text,
          custom_shopping_list_items.quantity,
          custom_shopping_list_items.unit,
          custom_shopping_list_items.item,
          custom_shopping_lists.name AS sourceName
        FROM menu_custom_shopping_lists
        JOIN custom_shopping_lists
          ON custom_shopping_lists.id = menu_custom_shopping_lists.custom_shopping_list_id
        JOIN custom_shopping_list_items
          ON custom_shopping_list_items.custom_shopping_list_id = custom_shopping_lists.id
        WHERE menu_custom_shopping_lists.menu_id = ?
        ORDER BY custom_shopping_lists.name COLLATE NOCASE, custom_shopping_list_items.sort_order`,
        [menuId]
      ) as AggregateSource[];
      return [...recipeSources, ...customSources];
    },

    replaceAggregatedItems(
      menuId: number,
      groups: AggregatedGroup[],
      remoteItems: OurGroceriesSnapshotItem[] = []
    ) {
      database.transaction(() => {
        database.run("DELETE FROM menu_shopping_list_items WHERE menu_id = ?", [menuId]);
        database.run("DELETE FROM menu_ourgroceries_items WHERE menu_id = ?", [menuId]);
        const remoteItemIds = new Map<string, number>();
        for (const remoteItem of remoteItems) {
          const id = database.insert(
            `INSERT INTO menu_ourgroceries_items
              (menu_id, remote_item_id, text, item, sort_order)
            VALUES (?, ?, ?, ?, ?)`,
            [
              menuId,
              remoteItem.remoteItemId,
              remoteItem.text,
              remoteItem.item,
              remoteItem.sortOrder
            ]
          );
          remoteItemIds.set(remoteItem.remoteItemId, id);
        }
          database.run(
            "UPDATE menu_ourgroceries_lists SET refreshed_at = CURRENT_TIMESTAMP WHERE menu_id = ?",
            [menuId]
          );
        groups.forEach((group, index) => {
          const shoppingItemId = database.insert(
            `INSERT INTO menu_shopping_list_items
              (menu_id, text, quantity, unit, item, source_names, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [menuId, group.item, group.quantity, "", group.item, group.sourceNames, index]
          );
          for (const source of group.sources) {
            if (
              source.sourceType === "recipe"
              && source.menuItemId !== null
              && source.recipeIngredientId !== null
            ) {
              database.run(
                `INSERT INTO menu_shopping_list_item_recipe_sources
                  (menu_shopping_list_item_id, menu_item_id, recipe_ingredient_id)
                VALUES (?, ?, ?)`,
                [shoppingItemId, source.menuItemId, source.recipeIngredientId]
              );
            } else if (source.customShoppingListItemId !== null) {
              database.run(
                `INSERT INTO menu_shopping_list_item_custom_sources
                  (menu_shopping_list_item_id, custom_shopping_list_item_id)
                VALUES (?, ?)`,
                [shoppingItemId, source.customShoppingListItemId]
              );
            } else if (source.ourGroceriesItemId !== null) {
              const remoteSnapshotId = remoteItemIds.get(source.ourGroceriesItemId);
              if (remoteSnapshotId) {
                database.run(
                  `INSERT INTO menu_shopping_list_item_ourgroceries_sources
                    (menu_shopping_list_item_id, menu_ourgroceries_item_id)
                  VALUES (?, ?)`,
                  [shoppingItemId, remoteSnapshotId]
                );
              }
            }
          }
        });
      });
    },

    clear(menuId: number) {
      database.run("DELETE FROM menu_shopping_list_items WHERE menu_id = ?", [menuId]);
      database.save();
    },

    updateItems(menuId: number, items: ShoppingItemUpdate[]) {
      database.transaction(() => {
        for (const item of items) {
          database.run(
            `UPDATE menu_shopping_list_items
            SET text = ?, quantity = ?, unit = ?, item = ?, approved = ?
            WHERE id = ? AND menu_id = ?`,
            [
              item.text ?? "",
              item.quantity ?? "",
              item.unit ?? "",
              item.item ?? "",
              item.approved ? 1 : 0,
              Number(item.id),
              menuId
            ]
          );
        }
      });
    },

    hasItem(menuId: number, itemId: number) {
      return Boolean(database.queryOne(
        "SELECT id FROM menu_shopping_list_items WHERE id = ? AND menu_id = ?",
        [itemId, menuId]
      ));
    },

    setApproval(menuId: number, itemId: number, approved: boolean) {
      database.run(
        "UPDATE menu_shopping_list_items SET approved = ? WHERE id = ? AND menu_id = ?",
        [approved ? 1 : 0, itemId, menuId]
      );
      database.save();
    },

    getSourceContext(menuId: number, itemId: number, dataScope: string) {
      const shoppingItem = database.queryOne<{ id: number; quantity: string; unit: string }>(
        "SELECT id, quantity, unit FROM menu_shopping_list_items WHERE id = ? AND menu_id = ?",
        [itemId, menuId]
      );
      const recipeSources = database.queryAll<{
        recipeIngredientId: number;
        recipeId: number;
      }>(
        `SELECT
          menu_shopping_list_item_recipe_sources.recipe_ingredient_id AS recipeIngredientId,
          recipe_ingredients.recipe_id AS recipeId
        FROM menu_shopping_list_item_recipe_sources
        JOIN menu_items
          ON menu_items.id = menu_shopping_list_item_recipe_sources.menu_item_id
          AND menu_items.menu_id = ?
        JOIN recipe_ingredients
          ON recipe_ingredients.id = menu_shopping_list_item_recipe_sources.recipe_ingredient_id
          AND recipe_ingredients.recipe_id = menu_items.recipe_id
        JOIN recipes ON recipes.id = recipe_ingredients.recipe_id
        WHERE menu_shopping_list_item_recipe_sources.menu_shopping_list_item_id = ?
          AND recipes.data_scope = ?`,
        [menuId, itemId, dataScope]
      );
      const customSources = database.queryAll<{
        customShoppingListItemId: number;
        customShoppingListId: number;
      }>(
        `SELECT
          custom_shopping_list_items.id AS customShoppingListItemId,
          custom_shopping_list_items.custom_shopping_list_id AS customShoppingListId
        FROM menu_shopping_list_item_custom_sources
        JOIN custom_shopping_list_items
          ON custom_shopping_list_items.id =
            menu_shopping_list_item_custom_sources.custom_shopping_list_item_id
        JOIN custom_shopping_lists
          ON custom_shopping_lists.id = custom_shopping_list_items.custom_shopping_list_id
        WHERE menu_shopping_list_item_custom_sources.menu_shopping_list_item_id = ?
          AND custom_shopping_lists.data_scope = ?`,
        [itemId, dataScope]
      );
      const ourGroceriesSources = database.queryAll<{ remoteItemId: string }>(
        `SELECT menu_ourgroceries_items.remote_item_id AS remoteItemId
        FROM menu_shopping_list_item_ourgroceries_sources
        JOIN menu_ourgroceries_items
          ON menu_ourgroceries_items.id =
            menu_shopping_list_item_ourgroceries_sources.menu_ourgroceries_item_id
        JOIN menus ON menus.id = menu_ourgroceries_items.menu_id
        WHERE menu_shopping_list_item_ourgroceries_sources.menu_shopping_list_item_id = ?
          AND menus.data_scope = ?`,
        [itemId, dataScope]
      );
      return { shoppingItem, recipeSources, customSources, ourGroceriesSources };
    },

    saveToSource(input: {
      menuId: number;
      itemId: number;
      item: string;
      quantity: string;
      unit: string;
      recipeSource?: { recipeIngredientId: number; recipeId: number };
      customSource?: { customShoppingListItemId: number; customShoppingListId: number };
    }) {
      database.transaction(() => {
        if (input.recipeSource) {
          database.run(
            "UPDATE recipe_ingredients SET item = ? WHERE id = ? AND recipe_id = ?",
            [input.item, input.recipeSource.recipeIngredientId, input.recipeSource.recipeId]
          );
          database.run(
            "UPDATE recipes SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [input.recipeSource.recipeId]
          );
        } else if (input.customSource) {
          database.run(
            `UPDATE custom_shopping_list_items
            SET item = ?
            WHERE id = ? AND custom_shopping_list_id = ?`,
            [
              input.item,
              input.customSource.customShoppingListItemId,
              input.customSource.customShoppingListId
            ]
          );
          database.run(
            "UPDATE custom_shopping_lists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [input.customSource.customShoppingListId]
          );
        }
        database.run(
          `UPDATE menu_shopping_list_items
          SET text = ?, quantity = ?, unit = ?, item = ?
          WHERE id = ? AND menu_id = ?`,
          [input.item, input.quantity, input.unit, input.item, input.itemId, input.menuId]
        );
      });
    }
  };
}

export type ShoppingListWorkflowRepository = ReturnType<
  typeof createShoppingListWorkflowRepository
>;
