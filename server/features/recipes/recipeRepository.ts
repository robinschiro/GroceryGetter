import type { GroceryDatabase } from "../../infrastructure/database/database.js";
import type { DataScope, Recipe, RecipeInput } from "../../../shared/contracts/index.js";

type RecipeRow = Omit<Recipe, "ingredients">;

export function createRecipeRepository(database: GroceryDatabase) {
  function findById(id: number, dataScope: DataScope): Recipe | null {
    const recipe = database.queryOne(
      `SELECT
        id,
        name,
        category,
        include_in_menu_generation AS includeInMenuGeneration,
        data_scope AS dataScope,
        servings,
        notes,
        source_path AS sourcePath,
        source_hash AS sourceHash,
        sync_status AS syncStatus
      FROM recipes
      WHERE id = ? AND data_scope = ?`,
      [id, dataScope]
    ) as RecipeRow | null;

    if (!recipe) {
      return null;
    }

    const ingredients = database.queryAll(
      `SELECT
        id,
        recipe_id AS recipeId,
        text,
        quantity,
        unit,
        item,
        sort_order AS sortOrder
      FROM recipe_ingredients
      WHERE recipe_id = ?
      ORDER BY sort_order, id`,
      [id]
    ) as Recipe["ingredients"];

    return {
      ...recipe,
      includeInMenuGeneration: Boolean(recipe.includeInMenuGeneration),
      ingredients
    };
  }

  function replaceIngredients(recipeId: number, ingredients: RecipeInput["ingredients"]) {
    database.run("DELETE FROM recipe_ingredients WHERE recipe_id = ?", [recipeId]);
    ingredients.forEach((ingredient, index) => {
      database.run(
        `INSERT INTO recipe_ingredients
          (recipe_id, text, quantity, unit, item, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [
          recipeId,
          ingredient.text.trim(),
          ingredient.quantity?.trim() ?? "",
          ingredient.unit?.trim() ?? "",
          ingredient.item.trim(),
          index
        ]
      );
    });
  }

  return {
    list(dataScope: DataScope) {
      const rows = database.queryAll<{ id: number }>(
        `SELECT id
        FROM recipes
        WHERE data_scope = ?
        ORDER BY category, name`,
        [dataScope]
      );
      return rows.map((row) => findById(row.id, dataScope));
    },

    findById,

    create(input: RecipeInput, dataScope: DataScope) {
      return database.transaction(() => {
        const recipeId = database.insert(
          `INSERT INTO recipes
            (name, category, data_scope, include_in_menu_generation, servings, notes, source_path, source_hash, sync_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            input.name.trim(),
            input.category,
            dataScope,
            input.includeInMenuGeneration ? 1 : 0,
            input.servings ?? null,
            input.notes?.trim() ?? "",
            input.sourcePath?.trim() || null,
            input.sourceHash?.trim() || null,
            input.syncStatus?.trim() || "manual"
          ]
        );
        replaceIngredients(recipeId, input.ingredients);
        return findById(recipeId, dataScope);
      });
    },

    update(recipeId: number, input: RecipeInput, existingRecipe: Recipe, dataScope: DataScope) {
      return database.transaction(() => {
        database.run(
          `UPDATE recipes
          SET
            name = ?,
            category = ?,
            include_in_menu_generation = ?,
            servings = ?,
            notes = ?,
            source_path = ?,
            source_hash = ?,
            sync_status = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [
            input.name.trim(),
            input.category,
            (input.includeInMenuGeneration ?? existingRecipe.includeInMenuGeneration) ? 1 : 0,
            input.servings ?? null,
            input.notes?.trim() ?? "",
            input.sourcePath?.trim() || null,
            input.sourceHash?.trim() || null,
            input.syncStatus?.trim() || "manual",
            recipeId
          ]
        );
        replaceIngredients(recipeId, input.ingredients);
        return findById(recipeId, dataScope);
      });
    },

    setMenuGeneration(recipeId: number, includeInMenuGeneration: boolean, dataScope: DataScope) {
      return database.transaction(() => {
        database.run(
          `UPDATE recipes
          SET include_in_menu_generation = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [includeInMenuGeneration ? 1 : 0, recipeId]
        );
        return findById(recipeId, dataScope);
      });
    },

    delete(recipeId: number) {
      database.transaction(() => {
        database.run("UPDATE menu_items SET recipe_id = NULL WHERE recipe_id = ?", [recipeId]);
        database.run("DELETE FROM recipes WHERE id = ?", [recipeId]);
      });
    }
  };
}

export type RecipeRepository = ReturnType<typeof createRecipeRepository>;
