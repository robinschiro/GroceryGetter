import type { GroceryDatabase } from "../../db.js";
import type {
  CustomShoppingList,
  CustomShoppingListInput,
  DataScope
} from "../../../shared/contracts/index.js";

function buildItemText(quantity: string, unit: string, item: string, fallback: string) {
  return [quantity, unit, item].filter(Boolean).join(" ").trim() || fallback;
}

export function createShoppingListRepository(database: GroceryDatabase) {
  function findById(id: number, dataScope: DataScope): CustomShoppingList | null {
    const list = database.queryOne<{
      id: number;
      name: string;
      dataScope: DataScope;
      includeInMenuByDefault: number;
    }>(
      `SELECT
        id,
        name,
        data_scope AS dataScope,
        include_in_menu_by_default AS includeInMenuByDefault
      FROM custom_shopping_lists
      WHERE id = ? AND data_scope = ?`,
      [id, dataScope]
    );
    if (!list) {
      return null;
    }

    const items = database.queryAll(
      `SELECT
        id,
        custom_shopping_list_id AS customShoppingListId,
        text,
        quantity,
        unit,
        item,
        sort_order AS sortOrder
      FROM custom_shopping_list_items
      WHERE custom_shopping_list_id = ?
      ORDER BY sort_order, id`,
      [id]
    ) as CustomShoppingList["items"];

    return {
      ...list,
      includeInMenuByDefault: Boolean(list.includeInMenuByDefault),
      items
    };
  }

  function replaceItems(listId: number, items: CustomShoppingListInput["items"]) {
    const existingIds = new Set(
      database.queryAll<{ id: number }>(
        "SELECT id FROM custom_shopping_list_items WHERE custom_shopping_list_id = ?",
        [listId]
      ).map((row) => row.id)
    );
    const retainedIds = new Set<number>();

    items.forEach((input, index) => {
      const item = input.item.trim();
      const quantity = input.quantity?.trim() ?? "";
      const unit = input.unit?.trim() ?? "";
      const text = input.text?.trim() || buildItemText(quantity, unit, item, item);
      const itemId = Number(input.id);
      if (Number.isInteger(itemId) && existingIds.has(itemId)) {
        database.run(
          `UPDATE custom_shopping_list_items
          SET text = ?, quantity = ?, unit = ?, item = ?, sort_order = ?
          WHERE id = ? AND custom_shopping_list_id = ?`,
          [text, quantity, unit, item, index, itemId, listId]
        );
        retainedIds.add(itemId);
      } else {
        retainedIds.add(database.insert(
          `INSERT INTO custom_shopping_list_items
            (custom_shopping_list_id, text, quantity, unit, item, sort_order)
          VALUES (?, ?, ?, ?, ?, ?)`,
          [listId, text, quantity, unit, item, index]
        ));
      }
    });

    for (const existingId of existingIds) {
      if (!retainedIds.has(existingId)) {
        database.run(
          "DELETE FROM custom_shopping_list_items WHERE id = ? AND custom_shopping_list_id = ?",
          [existingId, listId]
        );
      }
    }
  }

  return {
    list(dataScope: DataScope) {
      return database.queryAll<{ id: number }>(
        "SELECT id FROM custom_shopping_lists WHERE data_scope = ? ORDER BY name COLLATE NOCASE, id",
        [dataScope]
      ).map((list) => findById(list.id, dataScope)).filter(Boolean);
    },

    findById,

    create(input: CustomShoppingListInput, dataScope: DataScope) {
      return database.transaction(() => {
        const listId = database.insert(
          `INSERT INTO custom_shopping_lists (name, data_scope, include_in_menu_by_default)
          VALUES (?, ?, ?)`,
          [input.name.trim(), dataScope, input.includeInMenuByDefault ? 1 : 0]
        );
        replaceItems(listId, input.items);
        return findById(listId, dataScope);
      });
    },

    update(listId: number, input: CustomShoppingListInput, dataScope: DataScope) {
      return database.transaction(() => {
        database.run(
          `UPDATE custom_shopping_lists
          SET name = ?, include_in_menu_by_default = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [input.name.trim(), input.includeInMenuByDefault ? 1 : 0, listId]
        );
        replaceItems(listId, input.items);
        return findById(listId, dataScope);
      });
    },

    delete(listId: number) {
      database.run("DELETE FROM custom_shopping_lists WHERE id = ?", [listId]);
      database.save();
    }
  };
}

export type ShoppingListRepository = ReturnType<typeof createShoppingListRepository>;
