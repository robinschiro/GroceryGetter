export type RecipeCategory = "entree" | "vegetable_side" | "starch_side";

export type RecipeInput = {
  name: string;
  category: RecipeCategory;
  isTestData?: boolean;
  servings?: number | null;
  notes?: string;
  sourcePath?: string;
  sourceHash?: string;
  syncStatus?: string;
  ingredients: Array<{
    text: string;
    quantity?: string;
    unit?: string;
    item: string;
  }>;
};

export type Recipe = {
  id: number;
  name: string;
  category: RecipeCategory;
  isTestData: boolean;
  servings: number | null;
  notes: string;
  sourcePath: string | null;
  sourceHash: string | null;
  syncStatus: string;
  ingredients: RecipeIngredient[];
};

export type RecipeIngredient = {
  id: number;
  recipeId: number;
  text: string;
  quantity: string;
  unit: string;
  item: string;
  sortOrder: number;
};
