import type { GroceryDatabase } from "../database/database.js";
import { randomUUID } from "node:crypto";
import type { DataScope } from "../../types.js";

export type CartSubmissionItem = {
  id: number;
  text: string;
  quantity: string;
  unit: string;
  item: string;
  sourceNames: string;
  approved: number;
};

export type KrogerLocation = {
  locationId: string;
  name: string;
  chain?: string;
  address?: {
    addressLine1?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
};

export type KrogerProduct = {
  productId: string;
  upc: string;
  description: string;
  brand?: string;
  images?: Array<{
    perspective?: string;
    featured?: boolean;
    sizes?: Array<{
      size?: string;
      url?: string;
    }>;
  }>;
  items?: Array<{
    itemId?: string;
    size?: string;
    price?: {
      regular?: number;
      promo?: number;
    };
    inventory?: {
      stockLevel?: string;
    };
    fulfillment?: {
      curbside?: boolean;
      delivery?: boolean;
      inStore?: boolean;
      shipToHome?: boolean;
    };
  }>;
};

export type StoreItemCandidate = {
  productId: string;
  upc: string;
  description: string;
  brand: string;
  size: string;
  stockLevel: string;
  price: number | null;
  regularPrice: number | null;
  promotionalPrice: number | null;
  imageUrl: string;
  isStoreBrand: boolean;
};

export type CartSubmissionResult = {
  mode: "stub" | "api";
  submittedItemCount: number;
  message: string;
  items: CartSubmissionItem[];
  matched?: CartSubmissionMatch[];
  skipped?: CartSubmissionSkip[];
};

export type CartSubmissionProgress = {
  phase: "checking" | "matching" | "adding" | "complete";
  processedItems: number;
  totalItems: number;
  message: string;
};

export type CartSubmissionProgressHandler = (progress: CartSubmissionProgress) => void;

export type CartSubmissionMatch = {
  item: CartSubmissionItem;
  storeItem: StoreItemCandidate;
  candidates: StoreItemCandidate[];
  selectionSource: "remembered" | "general" | "search" | "preferred-unavailable";
  cartQuantity: number;
};

export type CartSubmissionSkip = {
  item: CartSubmissionItem;
  reason: string;
};

type ServiceToken = {
  accessToken: string;
  expiresAt: number;
};

type KrogerTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
};

export interface KrogerClient {
  exchangeToken(input: {
    clientId: string;
    clientSecret: string;
    params: URLSearchParams;
  }): Promise<KrogerTokenResponse>;
  searchLocations(input: {
    accessToken: string;
    query: string;
    limit: number;
  }): Promise<KrogerLocation[]>;
  searchProducts(input: {
    accessToken: string;
    term: string;
    locationId: string;
    limit: number;
  }): Promise<KrogerProduct[]>;
  addToCart(input: {
    accessToken: string;
    items: Array<{ upc: string; quantity: number; modality: "PICKUP" }>;
  }): Promise<void>;
}

const krogerBaseUrl = "https://api.kroger.com/v1";
const defaultRedirectUri = "http://127.0.0.1:5174/api/qfc/oauth/callback";
const tokenSkewMs = 60_000;
const storeBrandNames = ["Kroger", "QFC", "Simple Truth", "Private Selection"];
function getBasicAuthHeader(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) as unknown : {};

  if (!response.ok) {
    const message = body && typeof body === "object" && "errors" in body
      ? JSON.stringify((body as { errors: unknown }).errors)
      : text || response.statusText;
    throw new Error(`Kroger API request failed (${response.status}): ${message}`);
  }

  return body as T;
}

export class KrogerHttpClient implements KrogerClient {
  async exchangeToken(input: {
    clientId: string;
    clientSecret: string;
    params: URLSearchParams;
  }) {
    return requestJson<KrogerTokenResponse>(`${krogerBaseUrl}/connect/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: getBasicAuthHeader(input.clientId, input.clientSecret),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: input.params
    });
  }

  async searchLocations(input: { accessToken: string; query: string; limit: number }) {
    const params = new URLSearchParams({ "filter.limit": String(input.limit) });
    if (/^\d{5}/.test(input.query.trim())) {
      params.set("filter.zipCode.near", input.query.trim());
    } else {
      params.set("filter.term", input.query.trim());
    }
    const response = await requestJson<{ data: KrogerLocation[] }>(
      `${krogerBaseUrl}/locations?${params.toString()}`,
      { headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json" } }
    );
    return response.data ?? [];
  }

  async searchProducts(input: {
    accessToken: string;
    term: string;
    locationId: string;
    limit: number;
  }) {
    const params = new URLSearchParams({
      "filter.term": input.term.trim(),
      "filter.limit": String(input.limit)
    });
    if (input.locationId) params.set("filter.locationId", input.locationId);
    const response = await requestJson<{ data: KrogerProduct[] }>(
      `${krogerBaseUrl}/products?${params.toString()}`,
      { headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json" } }
    );
    return response.data ?? [];
  }

  async addToCart(input: {
    accessToken: string;
    items: Array<{ upc: string; quantity: number; modality: "PICKUP" }>;
  }) {
    await requestJson<unknown>(`${krogerBaseUrl}/cart/add`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ items: input.items })
    });
  }
}

export class FakeKrogerClient implements KrogerClient {
  readonly cartSubmissions: Array<Array<{ upc: string; quantity: number; modality: "PICKUP" }>> = [];

  async exchangeToken(): Promise<KrogerTokenResponse> {
    return {
      access_token: "fake-customer-access-token",
      refresh_token: "fake-customer-refresh-token",
      expires_in: 3600,
      scope: "cart.basic:write",
      token_type: "Bearer"
    };
  }

  async searchLocations(input: { query: string; limit: number }) {
    if (input.query.toLowerCase().includes("fail")) throw new Error("Deterministic fake location failure.");
    return [{
      locationId: "fake-qfc-001",
      name: "QFC Test Market",
      chain: "QFC",
      address: {
        addressLine1: "1 Test Market Way",
        city: "Seattle",
        state: "WA",
        zipCode: "98101"
      }
    }].slice(0, input.limit);
  }

  async searchProducts(input: { term: string; limit: number }) {
    const normalized = input.term.trim().toLowerCase();
    if (normalized.includes("fail")) throw new Error("Deterministic fake product failure.");
    if (normalized.includes("unmatched") || !normalized) return [];
    const preferredItemIsUnavailable = normalized.includes("preferred unavailable");
    const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
    const candidates: KrogerProduct[] = [
      {
        productId: `fake-${slug}-store`,
        upc: `000000${slug.length.toString().padStart(6, "0")}`,
        description: `Kroger ${input.term.trim()}`,
        brand: "Kroger",
        items: [{
          size: "12 oz",
          price: { regular: 2.49 },
          inventory: {
            stockLevel: preferredItemIsUnavailable ? "TEMPORARILY_OUT_OF_STOCK" : "HIGH"
          },
          fulfillment: { curbside: true }
        }]
      },
      {
        productId: `fake-${slug}-national`,
        upc: `111111${slug.length.toString().padStart(6, "0")}`,
        description: `Test Kitchen ${input.term.trim()}`,
        brand: "Test Kitchen",
        items: [{
          size: "10 oz",
          price: { regular: 3.99, promo: 3.49 },
          inventory: { stockLevel: "LOW" },
          fulfillment: { curbside: true }
        }]
      },
      {
        productId: `fake-${slug}-unavailable`,
        upc: `222222${slug.length.toString().padStart(6, "0")}`,
        description: `Pantry Select ${input.term.trim()}`,
        brand: "Pantry Select",
        items: [{
          size: "14 oz",
          inventory: { stockLevel: "TEMPORARILY_OUT_OF_STOCK" },
          fulfillment: { curbside: false }
        }]
      }
    ];
    return candidates.slice(0, input.limit);
  }

  async addToCart(input: {
    items: Array<{ upc: string; quantity: number; modality: "PICKUP" }>;
  }) {
    this.cartSubmissions.push(input.items.map((item) => ({ ...item })));
  }
}

type StoreItemPreferenceRow = {
  ingredientKey: string;
  ingredientName: string;
  provider: string;
  storeItemId: string;
  upc: string;
  description: string;
  brand: string;
  size: string;
  imageUrl: string;
  isStoreBrand: number;
  updatedAt: string;
};

export type StoreItemPreference = Omit<StoreItemPreferenceRow, "isStoreBrand"> & {
  isStoreBrand: boolean;
};

export function createQfcService(
  database: GroceryDatabase,
  krogerClient: KrogerClient = new KrogerHttpClient()
) {
let serviceToken: ServiceToken | null = null;

function getSetting(key: string) {
  const row = database.queryOne<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  return row?.value?.trim() ?? "";
}

function setSetting(key: string, value: string) {
  database.run(
    `INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
  database.save();
}

function requireSetting(key: string) {
  const value = getSetting(key);
  if (!value) {
    throw new Error(`Missing Kroger API setting: ${key}.`);
  }
  return value;
}

function getQfcApiStatus(dataScope: DataScope = "production") {
  const customerExpiresAt = Number(getSetting("krogerCustomerTokenExpiresAt") || 0);
  const clientId = getSetting("krogerClientId");
  return {
    clientId,
    hasClientId: Boolean(clientId),
    hasClientSecret: Boolean(getSetting("krogerClientSecret")),
    locationId: getScopedSetting(dataScope, "krogerLocationId"),
    hasCustomerAccessToken: Boolean(getSetting("krogerCustomerAccessToken")),
    hasCustomerRefreshToken: Boolean(getSetting("krogerCustomerRefreshToken")),
    customerTokenExpiresAt: customerExpiresAt,
    customerTokenExpired: Boolean(customerExpiresAt) && Date.now() > customerExpiresAt - tokenSkewMs,
    redirectUri: getCustomerRedirectUri(),
    serviceScopes: getSetting("krogerServiceScopes") || "product.compact",
    customerScopes: getSetting("krogerCustomerScopes") || "cart.basic:write"
  };
}

function saveQfcApiSettings(input: {
  clientId?: string;
  clientSecret?: string;
  locationId?: string;
  serviceScopes?: string;
  customerScopes?: string;
  redirectUri?: string;
}, dataScope: DataScope = "production") {
  if (input.clientId !== undefined) setSetting("krogerClientId", input.clientId.trim());
  if (input.clientSecret !== undefined) setSetting("krogerClientSecret", input.clientSecret.trim());
  if (input.locationId !== undefined) setScopedSetting(dataScope, "krogerLocationId", input.locationId.trim());
  if (input.serviceScopes !== undefined) setSetting("krogerServiceScopes", input.serviceScopes.trim());
  if (input.customerScopes !== undefined) setSetting("krogerCustomerScopes", input.customerScopes.trim());
  if (input.redirectUri !== undefined) setSetting("krogerRedirectUri", input.redirectUri.trim());
  serviceToken = null;
  return getQfcApiStatus(dataScope);
}

function getScopedSetting(dataScope: DataScope, key: string) {
  const row = database.queryOne<{ value: string }>(
    "SELECT value FROM scoped_settings WHERE data_scope = ? AND key = ?",
    [dataScope, key]
  );
  return row?.value?.trim() ?? "";
}

function setScopedSetting(dataScope: DataScope, key: string, value: string) {
  database.run(
    `INSERT INTO scoped_settings (data_scope, key, value)
      VALUES (?, ?, ?)
      ON CONFLICT(data_scope, key) DO UPDATE SET value = excluded.value`,
    [dataScope, key, value]
  );
  database.save();
}

function getCustomerRedirectUri() {
  return getSetting("krogerRedirectUri") || defaultRedirectUri;
}

function generateState() {
  return randomUUID();
}

function createCustomerAuthorizationUrl() {
  const clientId = requireSetting("krogerClientId");
  const redirectUri = getCustomerRedirectUri();
  const scope = getSetting("krogerCustomerScopes") || "cart.basic:write";
  const state = generateState();
  setSetting("krogerCustomerOAuthState", state);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    state
  });

  return {
    authorizationUrl: `${krogerBaseUrl}/connect/oauth2/authorize?${params.toString()}`,
    redirectUri,
    scope,
    state
  };
}

async function exchangeCustomerToken(params: URLSearchParams) {
  const clientId = requireSetting("krogerClientId");
  const clientSecret = requireSetting("krogerClientSecret");

  return krogerClient.exchangeToken({
    clientId,
    clientSecret,
    params
  });
}

function saveCustomerToken(token: {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}) {
  setSetting("krogerCustomerAccessToken", token.access_token);
  if (token.refresh_token) {
    setSetting("krogerCustomerRefreshToken", token.refresh_token);
  }
  setSetting("krogerCustomerTokenExpiresAt", String(Date.now() + token.expires_in * 1000));
  setSetting("krogerCustomerGrantedScopes", token.scope ?? "");
  setSetting("krogerCustomerTokenType", token.token_type ?? "Bearer");
}

async function exchangeCustomerAuthorizationCode(input: {
  code: string;
  state: string;
}) {
  const expectedState = requireSetting("krogerCustomerOAuthState");
  if (!input.state || input.state !== expectedState) {
    throw new Error("Kroger OAuth state did not match. Start the customer authorization flow again.");
  }

  const token = await exchangeCustomerToken(new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: getCustomerRedirectUri()
  }));
  saveCustomerToken(token);
  setSetting("krogerCustomerOAuthState", "");
  return getQfcApiStatus();
}

async function refreshCustomerToken() {
  const refreshToken = requireSetting("krogerCustomerRefreshToken");
  const token = await exchangeCustomerToken(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken
  }));
  saveCustomerToken(token);
  return getQfcApiStatus();
}

async function getCustomerAccessToken() {
  const accessToken = getSetting("krogerCustomerAccessToken");
  const expiresAt = Number(getSetting("krogerCustomerTokenExpiresAt") || 0);

  if (accessToken && Date.now() < expiresAt - tokenSkewMs) {
    return accessToken;
  }

  await refreshCustomerToken();
  return requireSetting("krogerCustomerAccessToken");
}

async function getServiceToken() {
  if (serviceToken && Date.now() < serviceToken.expiresAt - tokenSkewMs) {
    return serviceToken.accessToken;
  }

  const clientId = requireSetting("krogerClientId");
  const clientSecret = requireSetting("krogerClientSecret");
  const scope = getSetting("krogerServiceScopes") || "product.compact";

  const token = await krogerClient.exchangeToken({
    clientId,
    clientSecret,
    params: new URLSearchParams({
      grant_type: "client_credentials",
      scope
    })
  });

  serviceToken = {
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000
  };

  return serviceToken.accessToken;
}

async function searchLocations(query: string, limit = 10) {
  const accessToken = await getServiceToken();
  return krogerClient.searchLocations({ accessToken, query, limit });
}

function toStoreItemCandidate(product: KrogerProduct): StoreItemCandidate {
  const primaryItem = product.items?.[0];
  const brand = product.brand ?? "";
  const regularPrice = primaryItem?.price?.regular ?? null;
  const promotionalPrice = primaryItem?.price?.promo ?? null;
  const price = promotionalPrice ?? regularPrice;
  const image = product.images?.find((candidate) =>
    candidate.featured && candidate.perspective?.toLowerCase() === "front"
  ) ?? product.images?.find((candidate) => candidate.perspective?.toLowerCase() === "front")
    ?? product.images?.[0];
  const imageSizes = image?.sizes ?? [];
  const imageUrl = ["medium", "small", "large", "xlarge", "thumbnail"]
    .map((size) => imageSizes.find((candidate) => candidate.size?.toLowerCase() === size)?.url)
    .find(Boolean) ?? imageSizes.find((candidate) => candidate.url)?.url ?? "";

  return {
    productId: product.productId,
    upc: product.upc,
    description: product.description,
    brand,
    size: primaryItem?.size ?? "",
    stockLevel: primaryItem?.inventory?.stockLevel ?? "",
    price,
    regularPrice,
    promotionalPrice,
    imageUrl,
    isStoreBrand: storeBrandNames.some((name) => brand.toLowerCase().includes(name.toLowerCase()))
  };
}

async function searchStoreItems(
  term: string,
  options?: { locationId?: string; limit?: number; dataScope?: DataScope }
) {
  const accessToken = await getServiceToken();
  const locationId = options?.locationId
    ?? getScopedSetting(options?.dataScope ?? "production", "krogerLocationId");
  const products = await krogerClient.searchProducts({
    accessToken,
    term,
    locationId,
    limit: options?.limit ?? 10
  });
  return products.map(toStoreItemCandidate);
}

function prefersStoreBrands(dataScope: DataScope) {
  return getScopedSetting(dataScope, "preferStoreBrands") !== "false";
}

function chooseStoreItemCandidate(candidates: StoreItemCandidate[], dataScope: DataScope) {
  const inStock = candidates.filter((candidate) => candidate.stockLevel !== "TEMPORARILY_OUT_OF_STOCK");
  const pool = inStock.length ? inStock : candidates;
  if (prefersStoreBrands(dataScope)) {
    return pool.find((candidate) => candidate.isStoreBrand) ?? pool[0] ?? null;
  }
  return pool[0] ?? null;
}

function normalizeIngredientKey(ingredientName: string) {
  return ingredientName.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function toStoreItemPreference(row: StoreItemPreferenceRow): StoreItemPreference {
  return { ...row, isStoreBrand: Boolean(row.isStoreBrand) };
}

function getStoreItemPreferences(dataScope: DataScope): StoreItemPreference[] {
  const rows = database.queryAll<StoreItemPreferenceRow>(
    `SELECT
      ingredient_key AS ingredientKey,
      ingredient_name AS ingredientName,
      provider,
      store_item_id AS storeItemId,
      upc,
      description,
      brand,
      size,
      image_url AS imageUrl,
      is_store_brand AS isStoreBrand,
      updated_at AS updatedAt
    FROM store_item_preferences
    WHERE data_scope = ?
    ORDER BY ingredient_name COLLATE NOCASE`,
    [dataScope]
  );
  return rows.map(toStoreItemPreference);
}

function getStoreItemPreference(
  dataScope: DataScope,
  provider: string,
  ingredientName: string
): StoreItemPreference | null {
  const row = database.queryOne<StoreItemPreferenceRow>(
    `SELECT
      ingredient_key AS ingredientKey,
      ingredient_name AS ingredientName,
      provider,
      store_item_id AS storeItemId,
      upc,
      description,
      brand,
      size,
      image_url AS imageUrl,
      is_store_brand AS isStoreBrand,
      updated_at AS updatedAt
    FROM store_item_preferences
    WHERE data_scope = ? AND provider = ? AND ingredient_key = ?`,
    [dataScope, provider, normalizeIngredientKey(ingredientName)]
  );
  return row ? toStoreItemPreference(row) : null;
}

function saveStoreItemPreference(
  dataScope: DataScope,
  provider: string,
  ingredientName: string,
  storeItem: StoreItemCandidate
): StoreItemPreference {
  const normalizedIngredientName = ingredientName.trim();
  const ingredientKey = normalizeIngredientKey(normalizedIngredientName);
  if (!ingredientKey) {
    throw new Error("An ingredient name is required to remember a store item.");
  }

  database.run(
    `INSERT INTO store_item_preferences (
      data_scope, ingredient_key, ingredient_name, provider, store_item_id, upc,
      description, brand, size, image_url, is_store_brand
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(data_scope, provider, ingredient_key) DO UPDATE SET
      ingredient_name = excluded.ingredient_name,
      provider = excluded.provider,
      store_item_id = excluded.store_item_id,
      upc = excluded.upc,
      description = excluded.description,
      brand = excluded.brand,
      size = excluded.size,
      image_url = excluded.image_url,
      is_store_brand = excluded.is_store_brand,
      updated_at = CURRENT_TIMESTAMP`,
    [
      dataScope,
      ingredientKey,
      normalizedIngredientName,
      provider,
      storeItem.productId,
      storeItem.upc,
      storeItem.description,
      storeItem.brand,
      storeItem.size,
      storeItem.imageUrl,
      storeItem.isStoreBrand ? 1 : 0
    ]
  );
  database.save();
  return getStoreItemPreference(dataScope, provider, normalizedIngredientName)!;
}

function deleteStoreItemPreference(dataScope: DataScope, provider: string, ingredientKey: string) {
  database.run(
    "DELETE FROM store_item_preferences WHERE data_scope = ? AND provider = ? AND ingredient_key = ?",
    [dataScope, provider, ingredientKey]
  );
  database.save();
}

function preferenceToStoreItem(preference: StoreItemPreference): StoreItemCandidate {
  return {
    productId: preference.storeItemId,
    upc: preference.upc,
    description: preference.description,
    brand: preference.brand,
    size: preference.size,
    stockLevel: "",
    price: null,
    regularPrice: null,
    promotionalPrice: null,
    imageUrl: preference.imageUrl,
    isStoreBrand: preference.isStoreBrand
  };
}

function distinctStoreItems(candidates: StoreItemCandidate[]) {
  return candidates.filter((candidate, index) =>
    candidates.findIndex((other) => other.productId === candidate.productId && other.upc === candidate.upc) === index
  );
}

async function matchCartItems(
  dataScope: DataScope,
  items: CartSubmissionItem[],
  onProgress?: CartSubmissionProgressHandler
) {
  const matched: CartSubmissionMatch[] = [];
  const skipped: CartSubmissionSkip[] = [];

  for (const [index, item] of items.entries()) {
    const searchTerm = item.item.trim() || item.text.trim();
    onProgress?.({
      phase: "matching",
      processedItems: index,
      totalItems: items.length,
      message: `Matching ${searchTerm || "item"} with store items...`
    });

    if (!searchTerm) {
      skipped.push({ item, reason: "No searchable item text." });
      onProgress?.({
        phase: "matching",
        processedItems: index + 1,
        totalItems: items.length,
        message: "Skipped an item with no searchable text."
      });
      continue;
    }

    try {
      const searchedCandidates = await searchStoreItems(searchTerm, { limit: 10, dataScope });
      const preference = getStoreItemPreference(dataScope, "kroger", searchTerm);
      const searchedPreferredCandidate = preference
        ? searchedCandidates.find((candidate) =>
            candidate.productId === preference.storeItemId || candidate.upc === preference.upc
          )
        : null;
      const preferredCandidate = preference
        ? searchedPreferredCandidate ?? preferenceToStoreItem(preference)
        : null;
      const candidates = distinctStoreItems(preferredCandidate
        ? [preferredCandidate, ...searchedCandidates]
        : searchedCandidates);
      const preferredItemIsUnavailable =
        searchedPreferredCandidate?.stockLevel === "TEMPORARILY_OUT_OF_STOCK";
      const availableFallback = preferredItemIsUnavailable
        ? chooseStoreItemCandidate(
            searchedCandidates.filter((candidate) =>
              (
                candidate.productId !== searchedPreferredCandidate.productId
                || candidate.upc !== searchedPreferredCandidate.upc
              )
              && candidate.stockLevel !== "TEMPORARILY_OUT_OF_STOCK"
            ),
            dataScope
          )
        : null;
      const storeItem = availableFallback
        ?? preferredCandidate
        ?? chooseStoreItemCandidate(candidates, dataScope);
      if (!storeItem) {
        skipped.push({ item, reason: "No store item candidates found." });
        continue;
      }

      matched.push({
        item,
        storeItem,
        candidates,
        selectionSource: availableFallback
          ? "preferred-unavailable"
          : preferredCandidate
            ? "remembered"
            : "general",
        cartQuantity: 1
      });
    } catch (error) {
      skipped.push({
        item,
        reason: error instanceof Error ? error.message : "Store item search failed."
      });
    }

    onProgress?.({
      phase: "matching",
      processedItems: index + 1,
      totalItems: items.length,
      message: `Matched ${index + 1} of ${items.length} approved items.`
    });
  }

  return { matched, skipped };
}

async function addMatchedItemsToCart(matches: CartSubmissionMatch[]) {
  const accessToken = await getCustomerAccessToken();
  const items = matches.map((match) => ({
    upc: match.storeItem.upc,
    quantity: match.cartQuantity,
    modality: "PICKUP" as const
  }));

  await krogerClient.addToCart({ accessToken, items });
}

async function previewQfcCart(
  dataScope: DataScope,
  items: CartSubmissionItem[],
  onProgress?: CartSubmissionProgressHandler
): Promise<CartSubmissionResult> {
  onProgress?.({
    phase: "checking",
    processedItems: 0,
    totalItems: items.length,
    message: "Checking store API settings..."
  });

  const status = getQfcApiStatus(dataScope);
  if (!status.hasClientId || !status.hasClientSecret) {
    return {
      mode: "stub",
      submittedItemCount: 0,
      message: "Kroger API credentials are not configured yet, so store items cannot be previewed.",
      items
    };
  }

  const { matched, skipped } = await matchCartItems(dataScope, items, onProgress);
  if (!matched.length) {
    return {
      mode: "api",
      submittedItemCount: 0,
      message: "No approved ingredients could be matched to store items.",
      items,
      matched,
      skipped
    };
  }

  return {
    mode: "api",
    submittedItemCount: 0,
    message: `${matched.length} ingredient${matched.length === 1 ? "" : "s"} matched to store items. ${skipped.length} ingredient${skipped.length === 1 ? "" : "s"} unmatched.`,
    items,
    matched,
    skipped
  };
}

async function addQfcMatchesToCart(
  items: CartSubmissionItem[],
  matched: CartSubmissionMatch[],
  skipped: CartSubmissionSkip[],
  onProgress?: CartSubmissionProgressHandler
): Promise<CartSubmissionResult> {
  const status = getQfcApiStatus();
  if (!status.hasCustomerAccessToken) {
    return {
      mode: "stub",
      submittedItemCount: 0,
      message: "Connect your QFC customer account before adding the reviewed store items to the cart.",
      items,
      matched,
      skipped
    };
  }

  if (!matched.length) {
    return {
      mode: "api",
      submittedItemCount: 0,
      message: "There are no matched store items to add to the cart.",
      items,
      matched,
      skipped
    };
  }

  onProgress?.({
    phase: "adding",
    processedItems: items.length,
    totalItems: items.length,
    message: `Adding ${matched.length} matched item${matched.length === 1 ? "" : "s"} to your QFC cart...`
  });

  await addMatchedItemsToCart(matched);

  return {
    mode: "api",
    submittedItemCount: matched.length,
    message: `${matched.length} item${matched.length === 1 ? "" : "s"} added to the QFC cart. ${skipped.length} item${skipped.length === 1 ? "" : "s"} skipped.`,
    items,
    matched,
    skipped
  };
}

  return {
    addQfcMatchesToCart,
    createCustomerAuthorizationUrl,
    deleteStoreItemPreference,
    exchangeCustomerAuthorizationCode,
    getQfcApiStatus,
    getScopedSetting,
    getStoreItemPreferences,
    previewQfcCart,
    refreshCustomerToken,
    saveQfcApiSettings,
    saveStoreItemPreference,
    searchLocations,
    searchStoreItems,
    setScopedSetting
  };
}

export type QfcService = ReturnType<typeof createQfcService>;
