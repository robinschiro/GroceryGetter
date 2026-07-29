import type { Recipe, RecipeInput } from "../../../shared/contracts/index.js";
import type { ApiRequest } from "../../shared/apiClient.js";

export function listRecipes(api: ApiRequest) {
  return api<Array<Recipe | null>>("/api/recipes")
    .then((recipes) => recipes.filter(Boolean) as Recipe[]);
}

export function createRecipe(api: ApiRequest, input: RecipeInput) {
  return api<Recipe>("/api/recipes", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateRecipe(api: ApiRequest, recipeId: number, input: RecipeInput) {
  return api<Recipe>(`/api/recipes/${recipeId}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function deleteRecipe(api: ApiRequest, recipeId: number) {
  return api<{ id: number }>(`/api/recipes/${recipeId}`, { method: "DELETE" });
}

export function setRecipeMenuGeneration(
  api: ApiRequest,
  recipeId: number,
  includeInMenuGeneration: boolean
) {
  return api<Recipe>(`/api/recipes/${recipeId}/menu-generation`, {
    method: "PATCH",
    body: JSON.stringify({ includeInMenuGeneration })
  });
}
