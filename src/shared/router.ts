export type RecipeAdminTab = "create" | "manage";
export type ShoppingListsTab = "create" | "manage";
export type QfcSettingsTab = "api" | "preferences";
export type AppView = "recipe-admin" | "shopping-lists" | "qfc-api" | "planner";

export type AppRoute = {
  path: string;
  view: AppView;
  recipeAdminTab?: RecipeAdminTab;
  recipeId?: number;
  shoppingListsTab?: ShoppingListsTab;
  shoppingListId?: number;
  qfcSettingsTab?: QfcSettingsTab;
};

const appRoutes: AppRoute[] = [
  { path: "/planner", view: "planner" },
  { path: "/recipes/manage", view: "recipe-admin", recipeAdminTab: "manage" },
  { path: "/recipes/create", view: "recipe-admin", recipeAdminTab: "create" },
  { path: "/shopping-lists/manage", view: "shopping-lists", shoppingListsTab: "manage" },
  { path: "/shopping-lists/create", view: "shopping-lists", shoppingListsTab: "create" },
  { path: "/settings/qfc/api", view: "qfc-api", qfcSettingsTab: "api" },
  { path: "/settings/qfc/preferences", view: "qfc-api", qfcSettingsTab: "preferences" }
];

function normalizePathname(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

export function routeFromPathname(pathname: string) {
  const normalizedPathname = normalizePathname(pathname);
  const recipeEditMatch = /^\/recipes\/manage\/([1-9]\d*)$/.exec(normalizedPathname);
  if (recipeEditMatch) {
    return recipeEditRoute(Number(recipeEditMatch[1]));
  }
  const shoppingListEditMatch = /^\/shopping-lists\/manage\/([1-9]\d*)$/.exec(normalizedPathname);
  if (shoppingListEditMatch) {
    return shoppingListEditRoute(Number(shoppingListEditMatch[1]));
  }
  return appRoutes.find((route) => route.path === normalizedPathname) ?? appRoutes[0];
}

export function shoppingListEditRoute(shoppingListId: number): AppRoute {
  return {
    path: `/shopping-lists/manage/${shoppingListId}`,
    view: "shopping-lists",
    shoppingListsTab: "manage",
    shoppingListId
  };
}

export function recipeEditRoute(recipeId: number): AppRoute {
  return {
    path: `/recipes/manage/${recipeId}`,
    view: "recipe-admin",
    recipeAdminTab: "manage",
    recipeId
  };
}

export function defaultRouteForView(view: AppView) {
  return appRoutes.find((route) => route.view === view) ?? appRoutes[0];
}
