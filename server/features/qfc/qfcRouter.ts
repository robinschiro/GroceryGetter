import express from "express";
import type { GroceryDatabase } from "../../infrastructure/database/database.js";
import type { QfcService } from "../../infrastructure/kroger/krogerService.js";
import type { createPlannerRepository } from "../planner/plannerRepository.js";
import type { DataScope } from "../../types.js";
import { createQfcRepository } from "./qfcRepository.js";
import { createQfcWorkflowService, QfcWorkflowError } from "./qfcWorkflowService.js";

export function createQfcRouter({
  database,
  plannerRepository,
  qfcService
}: {
  database: GroceryDatabase;
  plannerRepository: ReturnType<typeof createPlannerRepository>;
  qfcService: QfcService;
}) {
  const {
    createCustomerAuthorizationUrl,
    deleteStoreItemPreference,
    exchangeCustomerAuthorizationCode,
    getQfcApiStatus,
    getStoreItemPreferences,
    refreshCustomerToken,
    saveQfcApiSettings,
    searchLocations,
    searchStoreItems,
    setScopedSetting
  } = qfcService;
  const app = express.Router();
  const qfcRepository = createQfcRepository(database);
  const qfcWorkflow = createQfcWorkflowService({
    plannerRepository,
    qfcRepository,
    qfcService
  });

function requestScope(res: express.Response): DataScope {
  return res.locals.dataScope as DataScope;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sendWorkflowError(res: express.Response, error: unknown) {
  if (error instanceof QfcWorkflowError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  res.status(400).json({
    error: error instanceof Error ? error.message : "Unable to complete the QFC workflow."
  });
}

app.get("/api/settings", (_req, res) => {
  res.json(qfcRepository.getScopedSettings(requestScope(res)));
});

app.put("/api/settings/:key", (req, res) => {
  const key = req.params.key;
  if (!["preferStoreBrands", "allowRealQfcCartMutation"].includes(key)) {
    res.status(400).json({ error: "This setting cannot be changed through the scoped settings API." });
    return;
  }
  const value = String(req.body.value ?? "");
  setScopedSetting(requestScope(res), key, value);
  res.json({ key, value });
});

app.get("/api/qfc/status", (_req, res) => {
  res.json(getQfcApiStatus(requestScope(res)));
});

app.put("/api/qfc/settings", (req, res) => {
  const dataScope = requestScope(res);
  const changesGlobalSettings = [
    req.body.clientId,
    req.body.clientSecret,
    req.body.serviceScopes,
    req.body.customerScopes,
    req.body.redirectUri
  ].some((value) => value !== undefined);
  if (dataScope === "sandbox" && changesGlobalSettings) {
    res.status(403).json({ error: "Switch to production mode to change QFC credentials or OAuth settings." });
    return;
  }
  res.json(saveQfcApiSettings({
    clientId: req.body.clientId,
    clientSecret: req.body.clientSecret,
    locationId: req.body.locationId,
    serviceScopes: req.body.serviceScopes,
    customerScopes: req.body.customerScopes,
    redirectUri: req.body.redirectUri
  }, dataScope));
});

app.post("/api/qfc/oauth/start", (_req, res) => {
  if (requestScope(res) === "sandbox") {
    res.status(403).json({ error: "Switch to production mode to connect a QFC customer account." });
    return;
  }
  try {
    res.json(createCustomerAuthorizationUrl());
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to start customer OAuth." });
  }
});

app.get("/api/qfc/oauth/callback", async (req, res) => {
  try {
    const error = req.query.error ? String(req.query.error) : "";
    if (error) {
      const description = req.query.error_description ? String(req.query.error_description) : error;
      res.status(400).send(`<!doctype html>
        <html><body>
          <h1>QFC authorization failed</h1>
          <p>${escapeHtml(description)}</p>
          <p>You can close this tab and try again from Grocery Getter.</p>
        </body></html>`);
      return;
    }

    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    if (!code) {
      res.status(400).send(`<!doctype html>
        <html><body>
          <h1>QFC authorization failed</h1>
          <p>Kroger did not include an authorization code.</p>
        </body></html>`);
      return;
    }

    await exchangeCustomerAuthorizationCode({ code, state });
    res.send(`<!doctype html>
      <html><body>
        <h1>QFC authorization complete</h1>
        <p>Grocery Getter has stored the customer OAuth token locally. You can close this tab and return to the app.</p>
      </body></html>`);
  } catch (error) {
    res.status(400).send(`<!doctype html>
      <html><body>
        <h1>QFC authorization failed</h1>
        <p>${escapeHtml(error instanceof Error ? error.message : "Unable to complete customer OAuth.")}</p>
      </body></html>`);
  }
});

app.post("/api/qfc/oauth/refresh", async (_req, res) => {
  if (requestScope(res) === "sandbox") {
    res.status(403).json({ error: "Switch to production mode to refresh QFC authorization." });
    return;
  }
  try {
    res.json(await refreshCustomerToken());
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to refresh customer token." });
  }
});

app.get("/api/qfc/locations", async (req, res) => {
  try {
    const query = String(req.query.query ?? "");
    const limit = Number(req.query.limit ?? 10);
    if (!query.trim()) {
      res.status(400).json({ error: "A location search query is required." });
      return;
    }

    res.json(await searchLocations(query, limit));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to search locations." });
  }
});

app.get("/api/qfc/store-items", async (req, res) => {
  try {
    const term = String(req.query.term ?? "");
    const limit = Number(req.query.limit ?? 10);
    const locationId = req.query.locationId ? String(req.query.locationId) : undefined;
    if (!term.trim()) {
      res.status(400).json({ error: "A store item search term is required." });
      return;
    }

    res.json(await searchStoreItems(term, { locationId, limit, dataScope: requestScope(res) }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to search store items." });
  }
});

app.get("/api/store-item-preferences", (_req, res) => {
  res.json(getStoreItemPreferences(requestScope(res)));
});

app.delete("/api/store-item-preferences/:provider/:ingredientKey", (req, res) => {
  deleteStoreItemPreference(requestScope(res), req.params.provider, req.params.ingredientKey);
  res.json({ ok: true });
});

app.post("/api/menus/:id/preview-qfc", (req, res) => {
  try {
    const job = qfcWorkflow.startPreview(Number(req.params.id), requestScope(res));
    res.status(202).json({ jobId: job.id, ...job });
  } catch (error) {
    sendWorkflowError(res, error);
  }
});

app.put("/api/store-item-reviews/:jobId/selections/:shoppingItemId", (req, res) => {
  try {
    res.json(qfcWorkflow.selectStoreItem(
      req.params.jobId,
      requestScope(res),
      Number(req.params.shoppingItemId),
      String(req.body.productId ?? ""),
      String(req.body.upc ?? "")
    ));
  } catch (error) {
    sendWorkflowError(res, error);
  }
});

app.put("/api/store-item-reviews/:jobId/quantities/:shoppingItemId", (req, res) => {
  try {
    res.json(qfcWorkflow.updateQuantity(
      req.params.jobId,
      requestScope(res),
      Number(req.params.shoppingItemId),
      Number(req.body.cartQuantity)
    ));
  } catch (error) {
    sendWorkflowError(res, error);
  }
});

app.post("/api/store-item-reviews/:jobId/items/:shoppingItemId/search", async (req, res) => {
  try {
    res.json(await qfcWorkflow.searchReviewItems(
      req.params.jobId,
      requestScope(res),
      Number(req.params.shoppingItemId),
      String(req.body.term ?? "")
    ));
  } catch (error) {
    sendWorkflowError(res, error);
  }
});

app.delete("/api/store-item-reviews/:jobId/items/:shoppingItemId", (req, res) => {
  try {
    res.json(qfcWorkflow.removeReviewItem(
      req.params.jobId,
      requestScope(res),
      Number(req.params.shoppingItemId)
    ));
  } catch (error) {
    sendWorkflowError(res, error);
  }
});

app.post("/api/qfc/submit-jobs/:jobId/add-to-cart", (req, res) => {
  try {
    const job = qfcWorkflow.startAddToCart(req.params.jobId, requestScope(res));
    res.status(202).json({ jobId: job.id, ...job });
  } catch (error) {
    sendWorkflowError(res, error);
  }
});

app.get("/api/qfc/submit-jobs/:jobId", (req, res) => {
  try {
    res.json(qfcWorkflow.getJob(req.params.jobId, requestScope(res)));
  } catch (error) {
    sendWorkflowError(res, error);
  }
});

  return app;
}
