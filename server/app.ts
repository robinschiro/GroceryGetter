import express from "express";
import { setDefaultDatabase, type GroceryDatabase } from "./db.js";
import type { QfcService } from "./qfcAdapter.js";
import { createRecipeRepository } from "./features/recipes/recipeRepository.js";
import { createRecipeRouter } from "./features/recipes/recipeRouter.js";
import { createRecipeService } from "./features/recipes/recipeService.js";
import { createShoppingListRepository } from "./features/shoppingLists/shoppingListRepository.js";
import { createShoppingListRouter } from "./features/shoppingLists/shoppingListRouter.js";
import { createShoppingListService } from "./features/shoppingLists/shoppingListService.js";
import { createPlannerRepository } from "./features/planner/plannerRepository.js";
import { createPlannerRouter } from "./features/planner/plannerRouter.js";
import { createPlannerService } from "./features/planner/plannerService.js";
import { createShoppingListWorkflowRepository } from "./features/planner/shoppingListRepository.js";
import { createShoppingListWorkflowService } from "./features/planner/shoppingListService.js";
import { createQfcRouter } from "./features/qfc/qfcRouter.js";
import { seedTestDatabase, type TestSeed } from "./testing/seedTestDatabase.js";
import type { DataScope } from "./types.js";

export function createApp({
  database,
  qfcService,
  testMode = false
}: {
  database: GroceryDatabase;
  qfcService: QfcService;
  testMode?: boolean;
}) {
  setDefaultDatabase(database);
  const plannerRepository = createPlannerRepository(database);
  const plannerService = createPlannerService(plannerRepository);
  const shoppingListWorkflowService = createShoppingListWorkflowService(
    plannerRepository,
    createShoppingListWorkflowRepository(database)
  );

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    const rawScope = req.header("X-Data-Scope")?.trim().toLowerCase() || "production";
    if (rawScope !== "production" && rawScope !== "sandbox") {
      res.status(400).json({ error: "Data scope must be production or sandbox." });
      return;
    }
    res.locals.dataScope = rawScope satisfies DataScope;
    next();
  });

  if (testMode) {
    app.post("/api/test/reset", async (req, res, next) => {
      try {
        await database.reset();
        setDefaultDatabase(database);
        const seeded = seedTestDatabase(database, (req.body?.seed ?? {}) as TestSeed);
        res.json({ reset: true, seeded });
      } catch (error) {
        next(error);
      }
    });
  }

  app.use(
    "/api/recipes",
    createRecipeRouter(createRecipeService(createRecipeRepository(database)))
  );
  app.use(
    "/api/custom-shopping-lists",
    createShoppingListRouter(createShoppingListService(createShoppingListRepository(database)))
  );
  app.use("/api", createPlannerRouter(plannerService, shoppingListWorkflowService));
  app.use(createQfcRouter({ database, plannerRepository, qfcService }));

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "Unknown server error.";
    res.status(400).json({ error: message });
  });

  return app;
}
