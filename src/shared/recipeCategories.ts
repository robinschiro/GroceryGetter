import type { RecipeCategory } from "../../shared/contracts/index.js";

export const recipeCategories: Array<{ value: RecipeCategory; label: string }> = [
  { value: "entree", label: "Entree" },
  { value: "vegetable_side", label: "Vegetable side" },
  { value: "starch_side", label: "Starch side" }
];

export type RecipeCategoryCount = (typeof recipeCategories)[number] & { count: number };
