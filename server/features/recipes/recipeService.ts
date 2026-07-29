import type { DataScope, RecipeInput } from "../../../shared/contracts/index.js";
import type { RecipeRepository } from "./recipeRepository.js";

export class RecipeNotFoundError extends Error {}

const recipeCategories = ["entree", "vegetable_side", "starch_side"];

function validateRecipeInput(input: RecipeInput) {
  if (!input.name?.trim()) {
    throw new Error("Recipe name is required.");
  }
  if (!recipeCategories.includes(input.category)) {
    throw new Error("Recipe category is invalid.");
  }
  if (
    input.includeInMenuGeneration !== undefined
    && typeof input.includeInMenuGeneration !== "boolean"
  ) {
    throw new Error("Recipe menu-generation selection is invalid.");
  }
  if (!Array.isArray(input.ingredients) || input.ingredients.length === 0) {
    throw new Error("At least one ingredient is required.");
  }
}

export function createRecipeService(repository: RecipeRepository) {
  function requireRecipe(recipeId: number, dataScope: DataScope) {
    const recipe = repository.findById(recipeId, dataScope);
    if (!recipe) {
      throw new RecipeNotFoundError("Recipe not found.");
    }
    return recipe;
  }

  return {
    list(dataScope: DataScope) {
      return repository.list(dataScope);
    },

    create(input: RecipeInput, dataScope: DataScope) {
      validateRecipeInput(input);
      return repository.create(input, dataScope);
    },

    update(recipeId: number, input: RecipeInput, dataScope: DataScope) {
      const recipe = requireRecipe(recipeId, dataScope);
      validateRecipeInput(input);
      return repository.update(recipeId, input, recipe, dataScope);
    },

    setMenuGeneration(recipeId: number, includeInMenuGeneration: unknown, dataScope: DataScope) {
      requireRecipe(recipeId, dataScope);
      if (typeof includeInMenuGeneration !== "boolean") {
        throw new Error("Recipe menu-generation selection is invalid.");
      }
      return repository.setMenuGeneration(recipeId, includeInMenuGeneration, dataScope);
    },

    delete(recipeId: number, dataScope: DataScope) {
      requireRecipe(recipeId, dataScope);
      repository.delete(recipeId);
      return { id: recipeId };
    }
  };
}

export type RecipeService = ReturnType<typeof createRecipeService>;
