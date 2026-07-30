import express from "express";
import type { DataScope, RecipeInput } from "../../../shared/contracts/index.js";
import { RecipeNotFoundError, type RecipeService } from "./recipeService.js";

function requestScope(res: express.Response) {
  return res.locals.dataScope as DataScope;
}

function recipeId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) ? id : null;
}

export function createRecipeRouter(service: RecipeService) {
  const router = express.Router();

  router.get("/", (_req, res) => {
    res.json(service.list(requestScope(res)));
  });

  router.post("/", (req, res) => {
    try {
      res.status(201).json(service.create(req.body as RecipeInput, requestScope(res)));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid recipe." });
    }
  });

  router.put("/:id", (req, res) => {
    const id = recipeId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: "Recipe id is invalid." });
      return;
    }
    try {
      res.json(service.update(id, req.body as RecipeInput, requestScope(res)));
    } catch (error) {
      if (error instanceof RecipeNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid recipe." });
    }
  });

  router.patch("/:id/menu-generation", (req, res) => {
    const id = recipeId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: "Recipe id is invalid." });
      return;
    }
    try {
      res.json(service.setMenuGeneration(
        id,
        req.body.includeInMenuGeneration,
        requestScope(res)
      ));
    } catch (error) {
      if (error instanceof RecipeNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof Error && error.message === "Recipe menu-generation selection is invalid.") {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unable to update recipe menu generation."
      });
    }
  });

  router.delete("/:id", (req, res) => {
    const id = recipeId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: "Recipe id is invalid." });
      return;
    }
    try {
      res.json(service.delete(id, requestScope(res)));
    } catch (error) {
      if (error instanceof RecipeNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unable to delete recipe."
      });
    }
  });

  return router;
}
