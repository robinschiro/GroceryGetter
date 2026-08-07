import type {
  DataScope,
  IngredientSummary,
  StoreItemPreference
} from "../../../shared/contracts/index.js";
import type { GroceryDatabase } from "../../infrastructure/database/database.js";
import { normalizeAggregateItem } from "../planner/shoppingListDomain.js";

type IngredientCandidate = {
  ingredientName: string;
  sourceType: "recipe" | "shoppingList";
  sourceId: number;
  sourceName: string;
};

type IngredientPreferenceRow = {
  ingredientKey: string;
  ingredientName: string;
  isPantry: number;
};

type StoreItemPreferenceRow = Omit<StoreItemPreference, "isStoreBrand"> & {
  isStoreBrand: number;
};

export function createIngredientRepository(database: GroceryDatabase) {
  function list(dataScope: DataScope): IngredientSummary[] {
    const candidates = database.queryAll<IngredientCandidate>(
      `SELECT recipe_ingredients.item AS ingredientName, 'recipe' AS sourceType,
        recipes.id AS sourceId, recipes.name AS sourceName
      FROM recipe_ingredients
      JOIN recipes ON recipes.id = recipe_ingredients.recipe_id
      WHERE recipes.data_scope = ?
      UNION ALL
      SELECT custom_shopping_list_items.item AS ingredientName,
        'shoppingList' AS sourceType, custom_shopping_lists.id AS sourceId,
        custom_shopping_lists.name AS sourceName
      FROM custom_shopping_list_items
      JOIN custom_shopping_lists
        ON custom_shopping_lists.id = custom_shopping_list_items.custom_shopping_list_id
      WHERE custom_shopping_lists.data_scope = ?`,
      [dataScope, dataScope]
    );
    const preferences = database.queryAll<IngredientPreferenceRow>(
      `SELECT ingredient_key AS ingredientKey, ingredient_name AS ingredientName,
        is_pantry AS isPantry
      FROM ingredient_preferences
      WHERE data_scope = ?`,
      [dataScope]
    );
    const storePreferences = database.queryAll<StoreItemPreferenceRow>(
      `SELECT ingredient_key AS ingredientKey, ingredient_name AS ingredientName,
        provider, store_item_id AS storeItemId, upc, description, brand, size,
        image_url AS imageUrl, is_store_brand AS isStoreBrand, updated_at AS updatedAt
      FROM store_item_preferences
      WHERE data_scope = ?
      ORDER BY ingredient_name COLLATE NOCASE, provider`,
      [dataScope]
    );

    const pantryByKey = new Map(preferences.map((preference) => [
      preference.ingredientKey,
      preference
    ]));
    const groups = new Map<string, {
      ingredientName: string;
      recipeIds: Set<number>;
      shoppingListIds: Set<number>;
      sources: Map<string, IngredientSummary["sources"][number]>;
      storeItemPreferences: StoreItemPreference[];
    }>();

    function ensure(key: string, name: string) {
      const current = groups.get(key);
      if (current) return current;
      const created = {
        ingredientName: name.trim() || key,
        recipeIds: new Set<number>(),
        shoppingListIds: new Set<number>(),
        sources: new Map<string, IngredientSummary["sources"][number]>(),
        storeItemPreferences: [] as StoreItemPreference[]
      };
      groups.set(key, created);
      return created;
    }

    for (const candidate of candidates) {
      const key = normalizeAggregateItem(candidate.ingredientName);
      if (!key) continue;
      const group = ensure(key, candidate.ingredientName);
      if (candidate.sourceType === "recipe") group.recipeIds.add(candidate.sourceId);
      else group.shoppingListIds.add(candidate.sourceId);
      group.sources.set(`${candidate.sourceType}:${candidate.sourceId}`, {
        type: candidate.sourceType,
        id: candidate.sourceId,
        name: candidate.sourceName
      });
    }
    for (const preference of preferences) {
      ensure(preference.ingredientKey, preference.ingredientName).ingredientName =
        preference.ingredientName;
    }
    for (const preference of storePreferences) {
      const key = normalizeAggregateItem(preference.ingredientName);
      if (!key) continue;
      ensure(key, preference.ingredientName).storeItemPreferences.push({
        ...preference,
        isStoreBrand: Boolean(preference.isStoreBrand)
      });
    }

    return Array.from(groups, ([ingredientKey, group]) => ({
      ingredientKey,
      ingredientName: pantryByKey.get(ingredientKey)?.ingredientName ?? group.ingredientName,
      isPantry: Boolean(pantryByKey.get(ingredientKey)?.isPantry),
      recipeCount: group.recipeIds.size,
      shoppingListCount: group.shoppingListIds.size,
      sources: Array.from(group.sources.values()).sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
      ),
      storeItemPreferences: group.storeItemPreferences
    })).sort((left, right) => left.ingredientName.localeCompare(
      right.ingredientName,
      undefined,
      { sensitivity: "base" }
    ));
  }

  function setPantry(
    dataScope: DataScope,
    ingredientKey: string,
    ingredientName: string,
    isPantry: boolean
  ) {
    if (!isPantry) {
      database.run(
        "DELETE FROM ingredient_preferences WHERE data_scope = ? AND ingredient_key = ?",
        [dataScope, ingredientKey]
      );
    } else {
      database.run(
        `INSERT INTO ingredient_preferences
          (data_scope, ingredient_key, ingredient_name, is_pantry)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(data_scope, ingredient_key) DO UPDATE SET
          ingredient_name = excluded.ingredient_name,
          is_pantry = 1,
          updated_at = CURRENT_TIMESTAMP`,
        [dataScope, ingredientKey, ingredientName]
      );
    }
    database.save();
  }

  function getPantryKeys(dataScope: DataScope) {
    return new Set(database.queryAll<{ ingredientKey: string }>(
      `SELECT ingredient_key AS ingredientKey
      FROM ingredient_preferences
      WHERE data_scope = ? AND is_pantry = 1`,
      [dataScope]
    ).map(({ ingredientKey }) => ingredientKey));
  }

  return { getPantryKeys, list, setPantry };
}

export type IngredientRepository = ReturnType<typeof createIngredientRepository>;
