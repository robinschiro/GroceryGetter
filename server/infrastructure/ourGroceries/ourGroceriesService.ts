import type {
  OurGroceriesListSummary,
  OurGroceriesStatus
} from "../../../shared/contracts/index.js";
import type { GroceryDatabase } from "../database/database.js";
import type { DataScope } from "../../types.js";

const baseUrl = "https://www.ourgroceries.com";
const signInUrl = `${baseUrl}/sign-in`;
const listsUrl = `${baseUrl}/your-lists/`;
const sessionCookieName = "ourgroceries-auth";
const requestTimeoutMs = 15_000;

const settingKeys = {
  email: "ourGroceriesEmail",
  password: "ourGroceriesPassword"
} as const;

const retiredOAuthSettingKeys = [
  "ourGroceriesOAuthClient",
  "ourGroceriesOAuthTokens",
  "ourGroceriesOAuthTokenExpiresAt",
  "ourGroceriesOAuthVerifier",
  "ourGroceriesOAuthState",
  "ourGroceriesRedirectUri",
  "ourGroceriesOAuthDiscovery"
];

export type OurGroceriesRemoteItem = {
  id: string;
  name: string;
  crossedOff: boolean;
};

type ConnectionStatus = Omit<OurGroceriesStatus, "defaultList" | "defaultListAvailable">;

export interface OurGroceriesRemoteClient {
  status(): ConnectionStatus;
  connect(email: string, password: string): Promise<void>;
  disconnect(): Promise<void>;
  listShoppingLists(): Promise<OurGroceriesListSummary[]>;
  getListItems(listId: string): Promise<OurGroceriesRemoteItem[]>;
}

type Session = {
  cookie: string;
  teamId: string;
  email: string;
  password: string;
};

function parseStored<T>(value: string): T | undefined {
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function maskedEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email ? "Configured account" : "";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}

function listWebUrl(listId: string) {
  return `${baseUrl}/your-lists/list/${encodeURIComponent(listId)}`;
}

function findArrays(value: unknown, names: string[], output: unknown[][] = []) {
  if (Array.isArray(value)) {
    value.forEach((entry) => findArrays(entry, names, output));
    return output;
  }
  const object = record(value);
  if (!object) return output;
  for (const [key, entry] of Object.entries(object)) {
    if (names.includes(key) && Array.isArray(entry)) output.push(entry);
    findArrays(entry, names, output);
  }
  return output;
}

function parseLists(payload: unknown) {
  const candidates = findArrays(payload, ["shoppingLists", "lists", "metalist"]).flat();
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    const item = record(candidate);
    if (!item) return [];
    const id = stringValue(item.id ?? item.listId);
    const name = stringValue(item.name ?? item.listName ?? item.title);
    const listType = stringValue(item.listType ?? item.type).toUpperCase();
    if (!id || !name || seen.has(id) || (listType && listType !== "SHOPPING")) return [];
    seen.add(id);
    return [{ id, name, webUrl: listWebUrl(id) } satisfies OurGroceriesListSummary];
  }).sort((left, right) => left.name.localeCompare(right.name));
}

function hasCrossedOffValue(value: unknown) {
  if (value === undefined || value === null || value === false || value === 0) return false;
  if (typeof value === "string") return !["", "false", "0"].includes(value.trim().toLowerCase());
  return true;
}

export function parseOurGroceriesItems(payload: unknown) {
  const candidates = findArrays(payload, ["items", "listItems"]).flat();
  const seen = new Set<string>();
  return candidates.flatMap((candidate, index) => {
    const item = record(candidate);
    if (!item) return [];
    const name = stringValue(item.value ?? item.name ?? item.text);
    const id = stringValue(item.id ?? item.itemId) || `${index}:${name}`;
    if (!name || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      name,
      crossedOff: hasCrossedOffValue(item.crossedOffAt) || hasCrossedOffValue(item.crossedOff)
    } satisfies OurGroceriesRemoteItem];
  });
}

function responseCookies(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  return values;
}

function sessionCookie(response: Response) {
  for (const value of responseCookies(response)) {
    const match = value.match(new RegExp(`(?:^|[,;]\\s*)${sessionCookieName}=([^;]+)`));
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return "";
}

async function login(email: string, password: string): Promise<Session> {
  const body = new URLSearchParams({ emailAddress: email, password, action: "sign-in" });
  const response = await fetch(signInUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  const cookie = sessionCookie(response);
  if (!cookie) throw new Error("OurGroceries did not accept that email address and password.");

  const listsPage = await fetch(listsUrl, {
    headers: { cookie: `${sessionCookieName}=${cookie}` },
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  const html = await listsPage.text();
  const teamId = html.match(/g_teamId\s*=\s*["']([^"']+)["']/)?.[1] ?? "";
  if (!listsPage.ok || !teamId) throw new Error("OurGroceries signed in but did not return the account's lists.");
  return { cookie, teamId, email, password };
}

async function postCommand(session: Session, command: string, details: Record<string, unknown> = {}) {
  const response = await fetch(listsUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${sessionCookieName}=${session.cookie}`
    },
    body: JSON.stringify({ command, teamId: session.teamId, ...details }),
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("OurGroceries rejected the saved credentials. Update them from settings.");
  }
  if (!response.ok) throw new Error(`OurGroceries returned HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    throw new Error("OurGroceries returned an unexpected response. Update the saved credentials and try again.");
  }
  return response.json() as Promise<unknown>;
}

export function createCredentialOurGroceriesClient(database: GroceryDatabase): OurGroceriesRemoteClient {
  let cachedSession: Session | null = null;

  function getSetting(key: string) {
    return database.queryOne<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key])?.value ?? "";
  }

  function saveCredentials(email: string, password: string) {
    database.transaction(() => {
      for (const [key, value] of [[settingKeys.email, email], [settingKeys.password, password]]) {
        database.run(
          `INSERT INTO settings (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          [key, value]
        );
      }
      retiredOAuthSettingKeys.forEach((key) => database.run("DELETE FROM settings WHERE key = ?", [key]));
    });
  }

  function clearCredentials() {
    database.transaction(() => {
      [...Object.values(settingKeys), ...retiredOAuthSettingKeys]
        .forEach((key) => database.run("DELETE FROM settings WHERE key = ?", [key]));
    });
    cachedSession = null;
  }

  async function authenticatedSession(forceLogin = false) {
    const email = getSetting(settingKeys.email);
    const password = getSetting(settingKeys.password);
    if (!email || !password) throw new Error("Connect an OurGroceries account first.");
    if (!forceLogin && cachedSession?.email === email && cachedSession.password === password) return cachedSession;
    cachedSession = await login(email, password);
    return cachedSession;
  }

  async function command(name: string, details?: Record<string, unknown>) {
    let session = await authenticatedSession();
    try {
      return await postCommand(session, name, details);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("saved credentials")) throw error;
      session = await authenticatedSession(true);
      return postCommand(session, name, details);
    }
  }

  return {
    status() {
      const email = getSetting(settingKeys.email);
      const password = getSetting(settingKeys.password);
      return {
        connected: Boolean(email && password),
        accountLabel: maskedEmail(email),
        hasStoredCredentials: Boolean(email && password)
      };
    },

    async connect(email, password) {
      const normalizedEmail = email.trim();
      if (!normalizedEmail || !password) throw new Error("An OurGroceries email address and password are required.");
      const session = await login(normalizedEmail, password);
      const overview = await postCommand(session, "getOverview");
      parseLists(overview);
      saveCredentials(normalizedEmail, password);
      cachedSession = session;
    },

    async disconnect() {
      clearCredentials();
    },

    async listShoppingLists() {
      return parseLists(await command("getOverview"));
    },

    async getListItems(listId) {
      if (!listId.trim()) throw new Error("An OurGroceries list id is required.");
      return parseOurGroceriesItems(await command("getList", { listId }));
    }
  };
}

export function createFakeOurGroceriesClient(): OurGroceriesRemoteClient {
  let connected = true;
  let accountLabel = "te**@example.com";
  const lists: OurGroceriesListSummary[] = [
    {
      id: "fake-ourgroceries-weekly",
      name: "OurGroceries Weekly",
      webUrl: "https://www.ourgroceries.com/your-lists/list/fake-ourgroceries-weekly"
    },
    {
      id: "fake-ourgroceries-costco",
      name: "Costco",
      webUrl: "https://www.ourgroceries.com/your-lists/list/fake-ourgroceries-costco"
    }
  ];
  return {
    status: () => ({ connected, accountLabel: connected ? accountLabel : "", hasStoredCredentials: connected }),
    async connect(email, password) {
      if (!email.trim() || !password) throw new Error("An OurGroceries email address and password are required.");
      connected = true;
      accountLabel = maskedEmail(email.trim());
    },
    async disconnect() {
      connected = false;
      accountLabel = "";
    },
    async listShoppingLists() {
      if (!connected) throw new Error("Connect an OurGroceries account first.");
      return lists;
    },
    async getListItems(listId) {
      if (!connected) throw new Error("Connect an OurGroceries account first.");
      if (!lists.some((list) => list.id === listId)) throw new Error("OurGroceries list was not found.");
      return [
        { id: `${listId}-tomato`, name: "tomato", crossedOff: false },
        { id: `${listId}-coffee`, name: "coffee", crossedOff: false },
        { id: `${listId}-done`, name: "already bought", crossedOff: true }
      ];
    }
  };
}

export function createOurGroceriesService(
  database: GroceryDatabase,
  remote: OurGroceriesRemoteClient
) {
  function getScopedDefault(dataScope: DataScope) {
    const value = database.queryOne<{ value: string }>(
      "SELECT value FROM scoped_settings WHERE data_scope = ? AND key = 'ourGroceriesDefaultList'",
      [dataScope]
    )?.value ?? "";
    return parseStored<OurGroceriesListSummary>(value) ?? null;
  }

  function saveScopedDefault(dataScope: DataScope, list: OurGroceriesListSummary | null) {
    if (list) {
      database.run(
        `INSERT INTO scoped_settings (data_scope, key, value) VALUES (?, 'ourGroceriesDefaultList', ?)
        ON CONFLICT(data_scope, key) DO UPDATE SET value = excluded.value`,
        [dataScope, JSON.stringify(list)]
      );
    } else {
      database.run(
        "DELETE FROM scoped_settings WHERE data_scope = ? AND key = 'ourGroceriesDefaultList'",
        [dataScope]
      );
    }
    database.save();
  }

  async function listShoppingLists() {
    return remote.listShoppingLists();
  }

  return {
    async status(dataScope: DataScope) {
      const defaultList = getScopedDefault(dataScope);
      let defaultListAvailable = !defaultList;
      if (defaultList && remote.status().connected) {
        try {
          defaultListAvailable = (await listShoppingLists()).some((list) => list.id === defaultList.id);
        } catch {
          defaultListAvailable = false;
        }
      }
      return { ...remote.status(), defaultList, defaultListAvailable } satisfies OurGroceriesStatus;
    },
    connect: remote.connect,
    disconnect: remote.disconnect,
    listShoppingLists,
    getListItems: remote.getListItems,
    getDefaultList: getScopedDefault,
    async getAvailableDefaultList(dataScope: DataScope) {
      const defaultList = getScopedDefault(dataScope);
      if (!defaultList || !remote.status().connected) return null;
      try {
        return (await listShoppingLists()).some((list) => list.id === defaultList.id)
          ? defaultList
          : null;
      } catch {
        return null;
      }
    },
    async setDefaultList(dataScope: DataScope, listId: string | null) {
      if (!listId) {
        saveScopedDefault(dataScope, null);
        return null;
      }
      const list = (await listShoppingLists()).find((candidate) => candidate.id === listId);
      if (!list) throw new Error("The selected OurGroceries list was not found.");
      saveScopedDefault(dataScope, list);
      return list;
    },
    async resolveList(listId: string) {
      const list = (await listShoppingLists()).find((candidate) => candidate.id === listId);
      if (!list) throw new Error("The selected OurGroceries list was not found.");
      return list;
    }
  };
}

export type OurGroceriesService = ReturnType<typeof createOurGroceriesService>;
