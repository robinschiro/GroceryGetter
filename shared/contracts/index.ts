export type DataScope = "production" | "sandbox";
export type RecipeCategory = "entree" | "vegetable_side" | "starch_side";

export type RecipeIngredient = {
  id?: number;
  recipeId?: number;
  text: string;
  quantity: string;
  unit: string;
  item: string;
  sortOrder?: number;
};

export type RecipeInput = {
  name: string;
  category: RecipeCategory;
  includeInMenuGeneration?: boolean;
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
  includeInMenuGeneration: boolean;
  dataScope: DataScope;
  servings: number | null;
  notes: string;
  sourcePath?: string | null;
  sourceHash?: string | null;
  syncStatus?: string;
  ingredients: RecipeIngredient[];
};

export type MenuItem = {
  id: number | null;
  mealNumber: number;
  slot: RecipeCategory;
  recipeId: number | null;
  recipeName: string | null;
};

export type Menu = {
  id: number | null;
  name: string;
  mealCount: number;
  dataScope: DataScope;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  items: MenuItem[];
  customShoppingListIds: number[];
  ourGroceriesList: OurGroceriesListSummary | null;
};

export type MenuSummary = {
  id: number;
  name: string;
  mealCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type OurGroceriesListSummary = {
  id: string;
  name: string;
  webUrl: string;
};

export type OurGroceriesStatus = {
  connected: boolean;
  accountLabel: string;
  hasStoredCredentials: boolean;
  defaultList: OurGroceriesListSummary | null;
  defaultListAvailable: boolean;
};

export type ShoppingListSourceTarget =
  | {
      type: "recipe" | "shoppingList";
      id: number;
      name: string;
    }
  | {
      type: "ourGroceries";
      id: string;
      name: string;
      webUrl: string;
    };

export type ShoppingListSourceDetail = ShoppingListSourceTarget & {
  text: string;
  quantity: string;
  unit: string;
};

export type ShoppingListItem = {
  id: number;
  text: string;
  quantity: string;
  unit: string;
  item: string;
  sourceNames: string;
  approved: number;
  sourceOccurrenceCount: number;
  canPersistToSource: number;
  sourceTargets: ShoppingListSourceTarget[];
  sourceDetails: ShoppingListSourceDetail[];
};

export type CustomShoppingListItem = {
  id?: number;
  customShoppingListId?: number;
  text: string;
  quantity: string;
  unit: string;
  item: string;
  sortOrder?: number;
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

export type QfcStatus = {
  clientId: string;
  hasClientId: boolean;
  hasClientSecret: boolean;
  locationId: string;
  hasCustomerAccessToken: boolean;
  hasCustomerRefreshToken: boolean;
  customerTokenExpiresAt: number;
  customerTokenExpired: boolean;
  redirectUri: string;
  serviceScopes: string;
  customerScopes: string;
};

export type QfcLocation = {
  locationId: string;
  name: string;
  chain?: string;
  address?: {
    addressLine1?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
};

export type StoreItemCandidate = {
  productId: string;
  upc: string;
  description: string;
  brand: string;
  size: string;
  stockLevel: string;
  price: number | null;
  regularPrice: number | null;
  promotionalPrice: number | null;
  imageUrl: string;
  isStoreBrand: boolean;
};

export type StoreItemMatch = {
  item: ShoppingListItem;
  storeItem: StoreItemCandidate;
  candidates: StoreItemCandidate[];
  selectionSource: "remembered" | "general" | "search" | "preferred-unavailable" | "review";
  cartQuantity: number;
};

export type QfcCartSkip = {
  item: ShoppingListItem;
  reason: string;
};

export type QfcSubmitProgress = {
  phase: "checking" | "matching" | "adding" | "complete";
  processedItems: number;
  totalItems: number;
  message: string;
};

export type QfcSubmitResult = {
  mode: "stub" | "api";
  submittedItemCount: number;
  message: string;
  items: ShoppingListItem[];
  matched?: StoreItemMatch[];
  skipped?: QfcCartSkip[];
};

export type QfcSubmitJob = {
  id: string;
  status: "running" | "complete" | "failed";
  progress: QfcSubmitProgress;
  result?: QfcSubmitResult;
  error?: string;
};

export type StoreItemPreference = {
  ingredientKey: string;
  ingredientName: string;
  provider: string;
  storeItemId: string;
  upc: string;
  description: string;
  brand: string;
  size: string;
  imageUrl: string;
  isStoreBrand: boolean;
  updatedAt: string;
};
