import express from "express";
import type { DataScope } from "../../../shared/contracts/index.js";
import { normalizeAggregateItem } from "../planner/shoppingListDomain.js";
import type { IngredientRepository } from "./ingredientRepository.js";

export function createIngredientRouter(repository: IngredientRepository) {
  const router = express.Router();
  const requestScope = (res: express.Response) => res.locals.dataScope as DataScope;

  router.get("/", (_req, res) => {
    res.json(repository.list(requestScope(res)));
  });

  router.put("/:ingredientKey/pantry", (req, res) => {
    const ingredientKey = normalizeAggregateItem(req.params.ingredientKey);
    const ingredientName = String(req.body.ingredientName ?? "").trim();
    if (!ingredientKey || !ingredientName || typeof req.body.isPantry !== "boolean") {
      res.status(400).json({ error: "An ingredient name and pantry status are required." });
      return;
    }
    if (ingredientKey !== normalizeAggregateItem(ingredientName)) {
      res.status(400).json({ error: "The ingredient name does not match its normalized key." });
      return;
    }
    repository.setPantry(requestScope(res), ingredientKey, ingredientName, req.body.isPantry);
    res.json({ ingredientKey, ingredientName, isPantry: req.body.isPantry });
  });

  return router;
}
