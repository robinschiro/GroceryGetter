import { queryOne, run, saveDb } from "./db.js";
import { randomUUID } from "node:crypto";

export type CartSubmissionItem = {
  id: number;
  text: string;
  quantity: string;
  unit: string;
  item: string;
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

export type ProductCandidate = {
  productId: string;
  upc: string;
  description: string;
  brand: string;
  size: string;
  stockLevel: string;
  price: number | null;
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

export type CartSubmissionMatch = {
  item: CartSubmissionItem;
  product: ProductCandidate;
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

const krogerBaseUrl = "https://api.kroger.com/v1";
const defaultRedirectUri = "http://127.0.0.1:5174/api/qfc/oauth/callback";
const tokenSkewMs = 60_000;
const storeBrandNames = ["Kroger", "QFC", "Simple Truth", "Private Selection"];
let serviceToken: ServiceToken | null = null;

function getSetting(key: string) {
  const row = queryOne<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  return row?.value?.trim() ?? "";
}

function setSetting(key: string, value: string) {
  run(
    `INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
  saveDb();
}

function requireSetting(key: string) {
  const value = getSetting(key);
  if (!value) {
    throw new Error(`Missing Kroger API setting: ${key}.`);
  }
  return value;
}

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

export function getQfcApiStatus() {
  const customerExpiresAt = Number(getSetting("krogerCustomerTokenExpiresAt") || 0);
  const clientId = getSetting("krogerClientId");
  return {
    clientId,
    hasClientId: Boolean(clientId),
    hasClientSecret: Boolean(getSetting("krogerClientSecret")),
    locationId: getSetting("krogerLocationId"),
    hasCustomerAccessToken: Boolean(getSetting("krogerCustomerAccessToken")),
    hasCustomerRefreshToken: Boolean(getSetting("krogerCustomerRefreshToken")),
    customerTokenExpiresAt: customerExpiresAt,
    customerTokenExpired: Boolean(customerExpiresAt) && Date.now() > customerExpiresAt - tokenSkewMs,
    redirectUri: getCustomerRedirectUri(),
    serviceScopes: getSetting("krogerServiceScopes") || "product.compact",
    customerScopes: getSetting("krogerCustomerScopes") || "cart.basic:write"
  };
}

export function saveQfcApiSettings(input: {
  clientId?: string;
  clientSecret?: string;
  locationId?: string;
  serviceScopes?: string;
  customerScopes?: string;
  redirectUri?: string;
}) {
  if (input.clientId !== undefined) setSetting("krogerClientId", input.clientId.trim());
  if (input.clientSecret !== undefined) setSetting("krogerClientSecret", input.clientSecret.trim());
  if (input.locationId !== undefined) setSetting("krogerLocationId", input.locationId.trim());
  if (input.serviceScopes !== undefined) setSetting("krogerServiceScopes", input.serviceScopes.trim());
  if (input.customerScopes !== undefined) setSetting("krogerCustomerScopes", input.customerScopes.trim());
  if (input.redirectUri !== undefined) setSetting("krogerRedirectUri", input.redirectUri.trim());
  serviceToken = null;
  return getQfcApiStatus();
}

function getCustomerRedirectUri() {
  return getSetting("krogerRedirectUri") || defaultRedirectUri;
}

function generateState() {
  return randomUUID();
}

export function createCustomerAuthorizationUrl() {
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

  return requestJson<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
    token_type: string;
  }>(`${krogerBaseUrl}/connect/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: getBasicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
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

export async function exchangeCustomerAuthorizationCode(input: {
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

export async function refreshCustomerToken() {
  const refreshToken = requireSetting("krogerCustomerRefreshToken");
  const token = await exchangeCustomerToken(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken
  }));
  saveCustomerToken(token);
  return getQfcApiStatus();
}

export async function getCustomerAccessToken() {
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

  const token = await requestJson<{
    access_token: string;
    expires_in: number;
  }>(`${krogerBaseUrl}/connect/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: getBasicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
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

export async function searchLocations(query: string, limit = 10) {
  const accessToken = await getServiceToken();
  const params = new URLSearchParams({
    "filter.limit": String(limit)
  });

  if (/^\d{5}/.test(query.trim())) {
    params.set("filter.zipCode.near", query.trim());
  } else {
    params.set("filter.term", query.trim());
  }

  const response = await requestJson<{ data: KrogerLocation[] }>(
    `${krogerBaseUrl}/locations?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    }
  );

  return response.data ?? [];
}

function toProductCandidate(product: KrogerProduct): ProductCandidate {
  const primaryItem = product.items?.[0];
  const brand = product.brand ?? "";
  const price = primaryItem?.price?.promo ?? primaryItem?.price?.regular ?? null;

  return {
    productId: product.productId,
    upc: product.upc,
    description: product.description,
    brand,
    size: primaryItem?.size ?? "",
    stockLevel: primaryItem?.inventory?.stockLevel ?? "",
    price,
    isStoreBrand: storeBrandNames.some((name) => brand.toLowerCase().includes(name.toLowerCase()))
  };
}

export async function searchProducts(term: string, options?: { locationId?: string; limit?: number }) {
  const accessToken = await getServiceToken();
  const locationId = options?.locationId ?? getSetting("krogerLocationId");
  const params = new URLSearchParams({
    "filter.term": term.trim(),
    "filter.limit": String(options?.limit ?? 10)
  });

  if (locationId) {
    params.set("filter.locationId", locationId);
  }

  const response = await requestJson<{ data: KrogerProduct[] }>(
    `${krogerBaseUrl}/products?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    }
  );

  return (response.data ?? []).map(toProductCandidate);
}

function prefersStoreBrands() {
  return getSetting("preferStoreBrands") !== "false";
}

function chooseProductCandidate(candidates: ProductCandidate[]) {
  const inStock = candidates.filter((candidate) => candidate.stockLevel !== "TEMPORARILY_OUT_OF_STOCK");
  const pool = inStock.length ? inStock : candidates;
  if (prefersStoreBrands()) {
    return pool.find((candidate) => candidate.isStoreBrand) ?? pool[0] ?? null;
  }
  return pool[0] ?? null;
}

async function matchCartItems(items: CartSubmissionItem[]) {
  const matched: CartSubmissionMatch[] = [];
  const skipped: CartSubmissionSkip[] = [];

  for (const item of items) {
    const searchTerm = item.item.trim() || item.text.trim();
    if (!searchTerm) {
      skipped.push({ item, reason: "No searchable item text." });
      continue;
    }

    try {
      const candidates = await searchProducts(searchTerm, { limit: 10 });
      const product = chooseProductCandidate(candidates);
      if (!product) {
        skipped.push({ item, reason: "No product candidates found." });
        continue;
      }

      matched.push({ item, product, cartQuantity: 1 });
    } catch (error) {
      skipped.push({
        item,
        reason: error instanceof Error ? error.message : "Product search failed."
      });
    }
  }

  return { matched, skipped };
}

async function addMatchedItemsToCart(matches: CartSubmissionMatch[]) {
  const accessToken = await getCustomerAccessToken();
  const items = matches.map((match) => ({
    upc: match.product.upc,
    quantity: match.cartQuantity,
    modality: "PICKUP"
  }));

  await requestJson<unknown>(`${krogerBaseUrl}/cart/add`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ items })
  });
}

export async function submitToQfcCart(items: CartSubmissionItem[]): Promise<CartSubmissionResult> {
  const status = getQfcApiStatus();
  if (!status.hasClientId || !status.hasClientSecret) {
    return {
      mode: "stub",
      submittedItemCount: 0,
      message: "Kroger API credentials are not configured yet. Product search and cart submission are disabled.",
      items
    };
  }

  if (!status.hasCustomerAccessToken) {
    return {
      mode: "stub",
      submittedItemCount: 0,
      message: "Product/location APIs can be used, but customer OAuth is not configured yet, so cart mutation is disabled.",
      items
    };
  }

  const { matched, skipped } = await matchCartItems(items);
  if (!matched.length) {
    return {
      mode: "api",
      submittedItemCount: 0,
      message: "No approved items could be matched to Kroger products, so nothing was added to the cart.",
      items,
      matched,
      skipped
    };
  }

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
