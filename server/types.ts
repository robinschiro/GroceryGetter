export type RecipeCategory = "entree" | "vegetable_side" | "starch_side";
export type DataScope = "production" | "sandbox";

export type RecipeInput = {
  name: string;
  category: RecipeCategory;
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
  dataScope: DataScope;
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

export type CustomShoppingListInput = {
  name: string;
  includeInMenuByDefault?: boolean;
  items: Array<{
    id?: number;
    text?: string;
    quantity?: string;
    unit?: string;
    item: string;
  }>;
};

export type CustomShoppingList = {
  id: number;
  name: string;
  dataScope: DataScope;
  includeInMenuByDefault: boolean;
  items: CustomShoppingListItem[];
};

export type CustomShoppingListItem = {
  id: number;
  customShoppingListId: number;
  text: string;
  quantity: string;
  unit: string;
  item: string;
  sortOrder: number;
};
