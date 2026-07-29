import express from "express";
import type { DataScope } from "../../../shared/contracts/index.js";
import { PlannerError, type PlannerService } from "./plannerService.js";

function requestScope(res: express.Response) {
  return res.locals.dataScope as DataScope;
}

function handlePlannerError(error: unknown, res: express.Response) {
  if (error instanceof PlannerError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  throw error;
}

export function createPlannerRouter(service: PlannerService) {
  const router = express.Router();

  router.post("/menus/preview", (req, res) => {
    try {
      res.json(service.preview(Number(req.body.mealCount ?? 5), requestScope(res)));
    } catch (error) {
      handlePlannerError(error, res);
    }
  });

  router.post("/menus", (req, res) => {
    try {
      res.status(201).json(service.create(req.body, requestScope(res)));
    } catch (error) {
      handlePlannerError(error, res);
    }
  });

  router.get("/menus/latest", (_req, res) => {
    res.json(service.getLatest(requestScope(res)));
  });

  router.get("/menus/:id", (req, res) => {
    try {
      res.json(service.get(Number(req.params.id), requestScope(res)));
    } catch (error) {
      handlePlannerError(error, res);
    }
  });

  router.post("/menus/:id/meals", (req, res) => {
    try {
      res.status(201).json(service.addMeal(
        Number(req.params.id),
        req.body.items,
        requestScope(res)
      ));
    } catch (error) {
      handlePlannerError(error, res);
    }
  });

  router.delete("/menus/:id/meals/:mealNumber", (req, res) => {
    try {
      res.json(service.removeMeal(
        Number(req.params.id),
        Number(req.params.mealNumber),
        requestScope(res)
      ));
    } catch (error) {
      handlePlannerError(error, res);
    }
  });

  router.put("/menu-items/:id", (req, res) => {
    try {
      res.json(service.updateMenuItem(
        req.params.id,
        req.body.recipeId,
        requestScope(res)
      ));
    } catch (error) {
      handlePlannerError(error, res);
    }
  });

  router.put("/menus/:id/custom-shopping-lists", (req, res) => {
    try {
      res.json(service.updateShoppingLists(
        Number(req.params.id),
        req.body.customShoppingListIds,
        requestScope(res)
      ));
    } catch (error) {
      handlePlannerError(error, res);
    }
  });

  return router;
}
