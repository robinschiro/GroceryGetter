import type { GroceryDatabase } from "../infrastructure/database/database.js";
import type { DataScope } from "../types.js";

type TestSeedIngredient = {
  text: string;
  quantity?: string;
  unit?: string;
  item: string;
};

export type TestSeed = {
  recipes?: Array<{
    name: string;
    category: "entree" | "vegetable_side" | "starch_side";
    dataScope?: DataScope;
    includeInMenuGeneration?: boolean;
    servings?: number | null;
    notes?: string;
    ingredients?: TestSeedIngredient[];
  }>;
  customShoppingLists?: Array<{
    name: string;
    dataScope?: DataScope;
    includeInMenuByDefault?: boolean;
    items?: TestSeedIngredient[];
  }>;
  settings?: Record<string, string>;
  scopedSettings?: Array<{ dataScope: DataScope; key: string; value: string }>;
};

export function seedTestDatabase(database: GroceryDatabase, seed: TestSeed) {
  database.transaction(() => {
    for (const [key, value] of Object.entries(seed.settings ?? {})) {
      database.run(
        `INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, value]
      );
    }
    for (const setting of seed.scopedSettings ?? []) {
      database.run(
        `INSERT INTO scoped_settings (data_scope, key, value) VALUES (?, ?, ?)
        ON CONFLICT(data_scope, key) DO UPDATE SET value = excluded.value`,
        [setting.dataScope, setting.key, setting.value]
      );
    }
    for (const recipe of seed.recipes ?? []) {
      const recipeId = database.insert(
        `INSERT INTO recipes (
          name, category, data_scope, include_in_menu_generation, servings, notes
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          recipe.name,
          recipe.category,
          recipe.dataScope ?? "production",
          recipe.includeInMenuGeneration === false ? 0 : 1,
          recipe.servings ?? null,
          recipe.notes ?? ""
        ]
      );
      for (const [sortOrder, ingredient] of (recipe.ingredients ?? []).entries()) {
        database.run(
          `INSERT INTO recipe_ingredients (
            recipe_id, text, quantity, unit, item, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            recipeId,
            ingredient.text,
            ingredient.quantity ?? "",
            ingredient.unit ?? "",
            ingredient.item,
            sortOrder
          ]
        );
      }
    }
    for (const list of seed.customShoppingLists ?? []) {
      const listId = database.insert(
        `INSERT INTO custom_shopping_lists (
          name, data_scope, include_in_menu_by_default
        ) VALUES (?, ?, ?)`,
        [
          list.name,
          list.dataScope ?? "production",
          list.includeInMenuByDefault ? 1 : 0
        ]
      );
      for (const [sortOrder, item] of (list.items ?? []).entries()) {
        database.run(
          `INSERT INTO custom_shopping_list_items (
            custom_shopping_list_id, text, quantity, unit, item, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            listId,
            item.text,
            item.quantity ?? "",
            item.unit ?? "",
            item.item,
            sortOrder
          ]
        );
      }
    }
  });

  return {
    recipes: seed.recipes?.length ?? 0,
    customShoppingLists: seed.customShoppingLists?.length ?? 0
  };
}
