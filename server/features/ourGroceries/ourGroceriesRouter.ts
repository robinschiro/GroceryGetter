import express from "express";
import type { OurGroceriesService } from "../../infrastructure/ourGroceries/ourGroceriesService.js";
import type { DataScope } from "../../types.js";

function requestScope(res: express.Response) {
  return res.locals.dataScope as DataScope;
}

function sendError(res: express.Response, error: unknown, fallback: string) {
  res.status(400).json({ error: error instanceof Error ? error.message : fallback });
}

export function createOurGroceriesRouter(service: OurGroceriesService) {
  const router = express.Router();

  router.get("/api/ourgroceries/status", async (_req, res) => {
    try {
      res.json(await service.status(requestScope(res)));
    } catch (error) {
      sendError(res, error, "Unable to load OurGroceries status.");
    }
  });

  router.get("/api/ourgroceries/lists", async (_req, res) => {
    try {
      res.json(await service.listShoppingLists());
    } catch (error) {
      sendError(res, error, "Unable to load OurGroceries lists.");
    }
  });

  router.put("/api/ourgroceries/default-list", async (req, res) => {
    try {
      const rawListId = req.body?.listId;
      const listId = rawListId === null || rawListId === "" ? null : String(rawListId ?? "").trim();
      if (rawListId !== null && !listId) {
        res.status(400).json({ error: "An OurGroceries list id or null is required." });
        return;
      }
      res.json({ defaultList: await service.setDefaultList(requestScope(res), listId) });
    } catch (error) {
      sendError(res, error, "Unable to save the default OurGroceries list.");
    }
  });

  router.put("/api/ourgroceries/connection", async (req, res) => {
    if (requestScope(res) === "sandbox") {
      res.status(403).json({ error: "Switch to production mode to connect an OurGroceries account." });
      return;
    }
    try {
      const email = String(req.body?.email ?? "").trim();
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      if (!email || !password) {
        res.status(400).json({ error: "An OurGroceries email address and password are required." });
        return;
      }
      await service.connect(email, password);
      res.json(await service.status(requestScope(res)));
    } catch (error) {
      sendError(res, error, "Unable to connect the OurGroceries account.");
    }
  });

  router.delete("/api/ourgroceries/connection", async (_req, res) => {
    if (requestScope(res) === "sandbox") {
      res.status(403).json({ error: "Switch to production mode to disconnect OurGroceries." });
      return;
    }
    try {
      await service.disconnect();
      res.json({ disconnected: true });
    } catch (error) {
      sendError(res, error, "Unable to disconnect OurGroceries.");
    }
  });

  return router;
}
