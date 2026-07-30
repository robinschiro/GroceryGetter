import express from "express";
import type { CustomShoppingListInput, DataScope } from "../../../shared/contracts/index.js";
import {
  ShoppingListNotFoundError,
  type ShoppingListService
} from "./shoppingListService.js";

function requestScope(res: express.Response) {
  return res.locals.dataScope as DataScope;
}

export function createShoppingListRouter(service: ShoppingListService) {
  const router = express.Router();

  router.get("/", (_req, res) => {
    res.json(service.list(requestScope(res)));
  });

  router.post("/", (req, res) => {
    try {
      res.status(201).json(service.create(
        req.body as CustomShoppingListInput,
        requestScope(res)
      ));
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to create the shopping list."
      });
    }
  });

  router.put("/:id", (req, res) => {
    const listId = Number(req.params.id);
    if (!Number.isInteger(listId)) {
      res.status(404).json({ error: "Shopping list not found." });
      return;
    }
    try {
      res.json(service.update(
        listId,
        req.body as CustomShoppingListInput,
        requestScope(res)
      ));
    } catch (error) {
      if (error instanceof ShoppingListNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to update the shopping list."
      });
    }
  });

  router.delete("/:id", (req, res) => {
    const listId = Number(req.params.id);
    if (!Number.isInteger(listId)) {
      res.status(404).json({ error: "Shopping list not found." });
      return;
    }
    try {
      res.json(service.delete(listId, requestScope(res)));
    } catch (error) {
      if (error instanceof ShoppingListNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  return router;
}
