import type { CustomShoppingListInput, DataScope } from "../../../shared/contracts/index.js";
import type { ShoppingListRepository } from "./shoppingListRepository.js";

export class ShoppingListNotFoundError extends Error {}

function validateInput(input: CustomShoppingListInput) {
  if (!input.name?.trim()) {
    throw new Error("Shopping list name is required.");
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("At least one shopping-list item is required.");
  }
  if (input.items.some((item) => !item.item?.trim())) {
    throw new Error("Shopping-list items must include an item name.");
  }
}

export function createShoppingListService(repository: ShoppingListRepository) {
  function requireList(listId: number, dataScope: DataScope) {
    const list = repository.findById(listId, dataScope);
    if (!list) {
      throw new ShoppingListNotFoundError("Shopping list not found.");
    }
    return list;
  }

  return {
    list(dataScope: DataScope) {
      return repository.list(dataScope);
    },

    create(input: CustomShoppingListInput, dataScope: DataScope) {
      validateInput(input);
      return repository.create(input, dataScope);
    },

    update(listId: number, input: CustomShoppingListInput, dataScope: DataScope) {
      requireList(listId, dataScope);
      validateInput(input);
      return repository.update(listId, input, dataScope);
    },

    delete(listId: number, dataScope: DataScope) {
      requireList(listId, dataScope);
      repository.delete(listId);
      return { ok: true };
    }
  };
}

export type ShoppingListService = ReturnType<typeof createShoppingListService>;
