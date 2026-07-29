import path from "node:path";
import { createApp } from "./app.js";
import { createDatabase, productionDatabasePath } from "./db.js";
import {
  createQfcService,
  FakeKrogerClient,
  KrogerHttpClient,
  setKrogerClient
} from "./qfcAdapter.js";

export function resolveDatabasePath(environment: NodeJS.ProcessEnv = process.env) {
  return path.resolve(environment.GROCERY_GETTER_DB_PATH || productionDatabasePath);
}

export function assertSafeTestDatabase(filePath: string, testMode: boolean) {
  if (testMode && path.resolve(filePath).toLowerCase() === productionDatabasePath.toLowerCase()) {
    throw new Error(
      "GROCERY_GETTER_TEST_MODE=1 refuses to use the production grocery database. " +
      "Set GROCERY_GETTER_DB_PATH to a disposable path such as .cache/tests/grocery-getter.sqlite."
    );
  }
}

const testMode = process.env.GROCERY_GETTER_TEST_MODE === "1";
const databasePath = resolveDatabasePath();
assertSafeTestDatabase(databasePath, testMode);

const database = createDatabase({ filePath: databasePath });
await database.initialize();

setKrogerClient(testMode ? new FakeKrogerClient() : new KrogerHttpClient());
const app = createApp({
  database,
  qfcService: createQfcService(),
  testMode
});

const port = Number(process.env.PORT ?? 5174);
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Grocery Getter API running on http://127.0.0.1:${port}`);
});

function shutdown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
