import type { DataScope, ShoppingListItem } from "../../../shared/contracts/index.js";
import type { PlannerRepository } from "./plannerRepository.js";
import type { OurGroceriesService } from "../../infrastructure/ourGroceries/ourGroceriesService.js";
import {
  formatQuantity,
  normalizeAggregateItem,
  parseQuantity
} from "./shoppingListDomain.js";
import type {
  ShoppingItemUpdate,
  ShoppingListWorkflowRepository
} from "./shoppingListRepository.js";
import { PlannerError } from "./plannerService.js";
import type { IngredientRepository } from "../ingredients/ingredientRepository.js";

export function createShoppingListWorkflowService(
  plannerRepository: PlannerRepository,
  repository: ShoppingListWorkflowRepository,
  ourGroceriesService: OurGroceriesService,
  ingredientRepository: IngredientRepository
) {
  function requireMenu(menuId: number, dataScope: DataScope) {
    const menu = Number.isInteger(menuId) ? plannerRepository.getMenu(menuId, dataScope) : null;
    if (!menu) {
      throw new PlannerError("Menu not found.", 404);
    }
    return menu;
  }

  return {
    async aggregate(menuId: number, dataScope: DataScope) {
      const menu = requireMenu(menuId, dataScope);
      let fetchedRemoteItems = [] as Awaited<ReturnType<typeof ourGroceriesService.getListItems>>;
      if (menu.ourGroceriesList) {
        try {
          fetchedRemoteItems = await ourGroceriesService.getListItems(menu.ourGroceriesList.id);
        } catch (error) {
          throw new PlannerError(
            error instanceof Error ? error.message : "Unable to refresh the selected OurGroceries list.",
            502
          );
        }
      }
      const remoteItems = menu.ourGroceriesList
        ? fetchedRemoteItems
            .filter((item) => !item.crossedOff)
            .map((item, sortOrder) => ({
              remoteItemId: item.id,
              text: item.name,
              item: item.name,
              sortOrder
            }))
        : [];
      const grouped = new Map<string, ReturnType<typeof repository.getAggregateSources>>();
      const pantryKeys = menu.ourGroceriesList
        ? ingredientRepository.getPantryKeys(dataScope)
        : new Set<string>();
      const remoteSources = remoteItems.map((item) => ({
        sourceType: "ourGroceries" as const,
        menuItemId: null,
        recipeIngredientId: null,
        customShoppingListItemId: null,
        ourGroceriesItemId: item.remoteItemId,
        text: item.text,
        quantity: "",
        unit: "",
        item: item.item,
        sourceName: `OurGroceries: ${menu.ourGroceriesList?.name ?? "List"}`
      }));
      for (const source of [...repository.getAggregateSources(menuId), ...remoteSources]) {
        const key = normalizeAggregateItem(source.item) || normalizeAggregateItem(source.text);
        grouped.set(key, [...(grouped.get(key) ?? []), source]);
      }
      const groups = Array.from(grouped.values())
        .sort((left, right) => {
          const leftName = left[0].item.trim() || left[0].text.trim();
          const rightName = right[0].item.trim() || right[0].text.trim();
          return leftName.localeCompare(rightName, undefined, { sensitivity: "base" });
        })
        .map((sources) => {
          const first = sources[0];
          const item = first.item.trim() || first.text.trim();
          const ingredientKey = normalizeAggregateItem(item);
          const hasActiveOurGroceriesItem = sources.some(
            (source) => source.sourceType === "ourGroceries"
          );
          const automaticallyExcluded = pantryKeys.has(ingredientKey)
            && !hasActiveOurGroceriesItem;
          const quantities = sources.map((source) => parseQuantity(source.quantity));
          const canSumUnitless = sources.every((source) => !source.unit.trim())
            && quantities.every((quantity): quantity is number => quantity !== null);
          return {
            item,
            quantity: canSumUnitless
              ? formatQuantity(quantities.reduce<number>((sum, value) => sum + value, 0))
              : "",
            sourceNames: Array.from(new Set(sources.map((source) => source.sourceName))).join(", "),
            sources,
            approved: !automaticallyExcluded,
            automaticExclusionReason: automaticallyExcluded ? "pantry" as const : null
          };
        });
      repository.replaceAggregatedItems(menuId, groups, remoteItems);
      return { ok: true };
    },

    list(menuId: number, dataScope: DataScope) {
      if (!Number.isInteger(menuId)) {
        throw new PlannerError("A valid menu id is required.", 400);
      }
      requireMenu(menuId, dataScope);
      return plannerRepository.getShoppingListItems(menuId, dataScope);
    },

    clear(menuId: number, dataScope: DataScope) {
      requireMenu(menuId, dataScope);
      repository.clear(menuId);
      return { ok: true };
    },

    updateItems(menuId: number, rawItems: unknown, dataScope: DataScope) {
      if (!Number.isInteger(menuId)) {
        throw new PlannerError("A valid menu id is required.", 400);
      }
      requireMenu(menuId, dataScope);
      if (!Array.isArray(rawItems)) {
        throw new PlannerError("Shopping list items must be an array.", 400);
      }
      if (rawItems.some((item) => !Number.isInteger(Number(item.id)))) {
        throw new PlannerError("Shopping list items must include valid ids.", 400);
      }
      repository.updateItems(menuId, rawItems as ShoppingItemUpdate[]);
      return { ok: true, updated: rawItems.length };
    },

    updateApproval(
      menuId: number,
      itemId: number,
      approved: unknown,
      dataScope: DataScope
    ) {
      if (!Number.isInteger(menuId) || !Number.isInteger(itemId)) {
        throw new PlannerError(
          "Valid menu and shopping-list item ids are required.",
          400
        );
      }
      requireMenu(menuId, dataScope);
      if (typeof approved !== "boolean") {
        throw new PlannerError("Approval must be true or false.", 400);
      }
      if (!repository.hasItem(menuId, itemId)) {
        throw new PlannerError("Shopping-list item not found for this menu.", 404);
      }
      repository.setApproval(menuId, itemId, approved);
      return { id: itemId, approved: approved ? 1 : 0 };
    },

    saveToSource(
      menuId: number,
      itemId: number,
      rawItem: unknown,
      dataScope: DataScope
    ) {
      if (!Number.isInteger(menuId) || !Number.isInteger(itemId)) {
        throw new PlannerError(
          "Valid menu and shopping-list item ids are required.",
          400
        );
      }
      requireMenu(menuId, dataScope);
      const item = String(rawItem ?? "").trim();
      if (!item) {
        throw new PlannerError(
          "An item name is required before saving to its source.",
          400
        );
      }
      const context = repository.getSourceContext(menuId, itemId, dataScope);
      if (!context.shoppingItem) {
        throw new PlannerError("Shopping-list item not found for this menu.", 404);
      }
      if (context.ourGroceriesSources.length) {
        throw new PlannerError("OurGroceries sources are read-only in Grocery Getter.", 409);
      }
      const sourceCount = context.recipeSources.length + context.customSources.length;
      if (sourceCount !== 1) {
        throw new PlannerError(
          sourceCount === 0
            ? "Re-aggregate this menu before saving changes to its source."
            : "Grouped or repeated items cannot be saved because they have multiple sources.",
          409
        );
      }
      const recipeSource = context.recipeSources[0];
      const customSource = context.customSources[0];
      repository.saveToSource({
        menuId,
        itemId,
        item,
        quantity: context.shoppingItem.quantity,
        unit: context.shoppingItem.unit,
        recipeSource,
        customSource
      });
      const updatedItem = plannerRepository
        .getShoppingListItems(menuId, dataScope)
        .find((candidate) => candidate.id === itemId) as ShoppingListItem | undefined;
      return {
        item: updatedItem,
        sourceType: recipeSource ? "recipe" : "custom",
        sourceId: recipeSource?.recipeId ?? customSource.customShoppingListId
      };
    }
  };
}

export type ShoppingListWorkflowService = ReturnType<
  typeof createShoppingListWorkflowService
>;
