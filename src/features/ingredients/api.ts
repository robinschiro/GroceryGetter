import type { IngredientSummary } from "../../../shared/contracts/index.js";
import type { ApiRequest } from "../../shared/apiClient.js";

export function listIngredients(api: ApiRequest) {
  return api<IngredientSummary[]>("/api/ingredients");
}

export function setIngredientPantryStatus(
  api: ApiRequest,
  ingredientKey: string,
  ingredientName: string,
  isPantry: boolean
) {
  return api<{ ingredientKey: string; ingredientName: string; isPantry: boolean }>(
    `/api/ingredients/${encodeURIComponent(ingredientKey)}/pantry`,
    {
      method: "PUT",
      body: JSON.stringify({ ingredientName, isPantry })
    }
  );
}
