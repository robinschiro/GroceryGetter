import type { DataScope, RecipeCategory } from "../../../shared/contracts/index.js";
import type { OurGroceriesService } from "../../infrastructure/ourGroceries/ourGroceriesService.js";
import type {
  MenuItemInput,
  PlannerRecipe,
  PlannerRepository
} from "./plannerRepository.js";

const recipeCategories = ["entree", "vegetable_side", "starch_side"] as const;

export class PlannerError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function validMealCount(mealCount: number) {
  return Number.isInteger(mealCount) && mealCount >= 1 && mealCount <= 14;
}

function shuffle<T>(items: T[]) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function byCategory(recipes: PlannerRecipe[]) {
  return {
    entree: recipes.filter((recipe) => recipe.category === "entree"),
    vegetable_side: recipes.filter((recipe) => recipe.category === "vegetable_side"),
    starch_side: recipes.filter((recipe) => recipe.category === "starch_side")
  };
}

export function createPlannerService(
  repository: PlannerRepository,
  ourGroceriesService: OurGroceriesService
) {
  async function resolveOurGroceriesList(listId: string) {
    try {
      return await ourGroceriesService.resolveList(listId);
    } catch (error) {
      throw new PlannerError(
        error instanceof Error ? error.message : "Unable to load the selected OurGroceries list.",
        400
      );
    }
  }

  function requireMenu(menuId: number, dataScope: DataScope) {
    const menu = Number.isInteger(menuId) ? repository.getMenu(menuId, dataScope) : null;
    if (!menu) {
      throw new PlannerError("Menu not found.", 404);
    }
    return menu;
  }

  function requireMatchingRecipe(
    recipeId: number,
    slot: RecipeCategory,
    dataScope: DataScope,
    message: string
  ) {
    if (repository.getRecipeCategory(recipeId, dataScope) !== slot) {
      throw new PlannerError(message, 400);
    }
  }

  return {
    list(dataScope: DataScope) {
      return repository.listMenus(dataScope);
    },

    async preview(mealCount: number, dataScope: DataScope) {
      if (!validMealCount(mealCount)) {
        throw new PlannerError("Meal count must be between 1 and 14.", 400);
      }
      const grouped = byCategory(repository.listGenerationRecipes(dataScope));
      if (!grouped.entree.length) {
        throw new PlannerError(
          "Select at least one entree recipe for menu generation before generating a menu.",
          400
        );
      }
      const shuffled = {
        entree: shuffle(grouped.entree),
        vegetable_side: shuffle(grouped.vegetable_side),
        starch_side: shuffle(grouped.starch_side)
      };
      return {
        id: null,
        name: `Week of ${new Date().toLocaleDateString("en-US")}`,
        mealCount,
        dataScope,
        status: "preview",
        items: Array.from({ length: mealCount }, (_, index) => index + 1).flatMap(
          (mealNumber) => recipeCategories.map((slot) => {
            const candidates = shuffled[slot];
            const recipe = candidates[(mealNumber - 1) % candidates.length];
            return {
              id: null,
              mealNumber,
              slot,
              recipeId: recipe?.id ?? null,
              recipeName: recipe?.name ?? null
            };
          })
        ),
        customShoppingListIds: repository.listDefaultShoppingListIds(dataScope),
        ourGroceriesList: await ourGroceriesService.getAvailableDefaultList(dataScope)
      };
    },

    async create(input: {
      name?: unknown;
      mealCount?: unknown;
      items?: unknown;
      customShoppingListIds?: unknown;
      ourGroceriesListId?: unknown;
    }, dataScope: DataScope) {
      const mealCount = Number(input.mealCount);
      const items = Array.isArray(input.items) ? input.items as MenuItemInput[] : [];
      const shoppingListIds: number[] = Array.isArray(input.customShoppingListIds)
        ? Array.from(new Set<number>(
          input.customShoppingListIds.map((id: unknown) => Number(id))
        ))
        : [];
      const ourGroceriesListId = input.ourGroceriesListId === null
        || input.ourGroceriesListId === undefined
        || input.ourGroceriesListId === ""
        ? null
        : String(input.ourGroceriesListId).trim();
      if (!validMealCount(mealCount)) {
        throw new PlannerError("Meal count must be between 1 and 14.", 400);
      }
      if (items.length !== mealCount * recipeCategories.length) {
        throw new PlannerError(
          "Saved menus must include one recipe for every meal slot.",
          400
        );
      }
      if (shoppingListIds.some((id) => !Number.isInteger(id))) {
        throw new PlannerError("Custom shopping-list selections are invalid.", 400);
      }
      if (repository.countShoppingLists(shoppingListIds, dataScope) !== shoppingListIds.length) {
        throw new PlannerError(
          "One or more selected custom shopping lists do not exist.",
          400
        );
      }

      const seenSlots = new Set<string>();
      for (const item of items) {
        const mealNumber = Number(item.mealNumber);
        const recipeId = item.recipeId === null ? null : Number(item.recipeId);
        if (!Number.isInteger(mealNumber) || mealNumber < 1 || mealNumber > mealCount) {
          throw new PlannerError("Menu items include an invalid meal number.", 400);
        }
        if (
          !recipeCategories.includes(item.slot)
          || (recipeId !== null && !Number.isInteger(recipeId))
        ) {
          throw new PlannerError("Menu items include an invalid recipe selection.", 400);
        }
        if (item.slot === "entree" && recipeId === null) {
          throw new PlannerError("Entree slots must include a recipe.", 400);
        }
        const key = `${mealNumber}:${item.slot}`;
        if (seenSlots.has(key)) {
          throw new PlannerError("Saved menus cannot include duplicate meal slots.", 400);
        }
        seenSlots.add(key);
        if (recipeId !== null) {
          requireMatchingRecipe(
            recipeId,
            item.slot,
            dataScope,
            "Menu items include a recipe that does not match its meal slot."
          );
        }
      }
      const name = String(input.name || `Week of ${new Date().toLocaleDateString("en-US")}`);
      const ourGroceriesList = ourGroceriesListId
        ? await resolveOurGroceriesList(ourGroceriesListId)
        : null;
      return {
        id: repository.createMenu(
          name,
          mealCount,
          items,
          shoppingListIds,
          ourGroceriesList,
          dataScope
        )
      };
    },

    getLatest(dataScope: DataScope) {
      return repository.getLatestMenu(dataScope);
    },

    get(menuId: number, dataScope: DataScope) {
      return requireMenu(menuId, dataScope);
    },

    delete(menuId: number, dataScope: DataScope) {
      requireMenu(menuId, dataScope);
      repository.deleteMenu(menuId, dataScope);
      return { id: menuId };
    },

    addMeal(menuId: number, rawItems: unknown, dataScope: DataScope) {
      const menu = requireMenu(menuId, dataScope);
      const items = Array.isArray(rawItems) ? rawItems as MenuItemInput[] : [];
      if (menu.mealCount >= 14) {
        throw new PlannerError("Menus cannot include more than 14 meals.", 400);
      }
      if (items.length !== recipeCategories.length) {
        throw new PlannerError("New meals must include every meal slot.", 400);
      }
      const seenSlots = new Set<RecipeCategory>();
      for (const item of items) {
        const recipeId = item.recipeId === null ? null : Number(item.recipeId);
        if (!recipeCategories.includes(item.slot) || seenSlots.has(item.slot)) {
          throw new PlannerError(
            "New meals include an invalid or duplicate meal slot.",
            400
          );
        }
        seenSlots.add(item.slot);
        if (item.slot === "entree" && recipeId === null) {
          throw new PlannerError("Entree slots must include a recipe.", 400);
        }
        if (recipeId === null) continue;
        if (!Number.isInteger(recipeId)) {
          throw new PlannerError("New meals include an invalid recipe selection.", 400);
        }
        requireMatchingRecipe(
          recipeId,
          item.slot,
          dataScope,
          "New meals include a recipe that does not match its meal slot."
        );
      }
      return repository.addMeal(menuId, menu.mealCount + 1, items, dataScope);
    },

    removeMeal(menuId: number, mealNumber: number, dataScope: DataScope) {
      const menu = requireMenu(menuId, dataScope);
      if (
        !Number.isInteger(mealNumber)
        || mealNumber < 1
        || mealNumber > menu.mealCount
      ) {
        throw new PlannerError("A valid meal number is required.", 400);
      }
      if (menu.mealCount === 1) {
        throw new PlannerError("A menu must include at least one meal.", 400);
      }
      return repository.removeMeal(menuId, mealNumber, dataScope);
    },

    updateMenuItem(menuItemId: string, rawRecipeId: unknown, dataScope: DataScope) {
      const slot = repository.getMenuItemSlot(menuItemId, dataScope);
      if (!slot) {
        throw new PlannerError("Menu item not found.", 404);
      }
      const recipeId = rawRecipeId === null ? null : Number(rawRecipeId);
      if (recipeId === null) {
        if (slot === "entree") {
          throw new PlannerError("Entree slots must include a recipe.", 400);
        }
      } else {
        if (!Number.isInteger(recipeId)) {
          throw new PlannerError("Menu item includes an invalid recipe selection.", 400);
        }
        requireMatchingRecipe(
          recipeId,
          slot,
          dataScope,
          "Menu item includes a recipe that does not match its meal slot."
        );
      }
      repository.updateMenuItem(menuItemId, recipeId);
      return { ok: true };
    },

    updateShoppingLists(menuId: number, rawIds: unknown, dataScope: DataScope) {
      requireMenu(menuId, dataScope);
      const ids: number[] | null = Array.isArray(rawIds)
        ? Array.from(new Set<number>(rawIds.map((id: unknown) => Number(id))))
        : null;
      if (!ids || ids.some((id) => !Number.isInteger(id))) {
        throw new PlannerError("Custom shopping-list selections are invalid.", 400);
      }
      if (repository.countShoppingLists(ids, dataScope) !== ids.length) {
        throw new PlannerError(
          "One or more selected custom shopping lists do not exist.",
          400
        );
      }
      repository.replaceShoppingLists(menuId, ids);
      return { customShoppingListIds: ids };
    },

    async updateOurGroceriesList(menuId: number, rawListId: unknown, dataScope: DataScope) {
      requireMenu(menuId, dataScope);
      const listId = rawListId === null || rawListId === ""
        ? null
        : String(rawListId ?? "").trim();
      if (rawListId !== null && !listId) {
        throw new PlannerError("An OurGroceries list id or null is required.", 400);
      }
      const list = listId ? await resolveOurGroceriesList(listId) : null;
      repository.replaceOurGroceriesList(menuId, list);
      return requireMenu(menuId, dataScope);
    }
  };
}

export type PlannerService = ReturnType<typeof createPlannerService>;
