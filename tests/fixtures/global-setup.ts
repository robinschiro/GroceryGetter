import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { build, preview, type PreviewServer } from "vite";
import { createApp } from "../../server/app.js";
import { createDatabase, productionDatabasePath } from "../../server/infrastructure/database/database.js";
import {
  createQfcService,
  FakeKrogerClient
} from "../../server/infrastructure/kroger/krogerService.js";

const apiPort = 5194;
const webPort = 5193;
const disposableDatabasePath = path.resolve(".cache", "tests", "characterization.sqlite");

async function closeHttpServer(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

export default async function globalSetup() {
  if (disposableDatabasePath.toLowerCase() === productionDatabasePath.toLowerCase()) {
    throw new Error("Characterization tests refuse to use the production grocery database.");
  }
  fs.mkdirSync(path.dirname(disposableDatabasePath), { recursive: true });

  const database = createDatabase({ filePath: disposableDatabasePath });
  await database.initialize();
  const app = createApp({
    database,
    qfcService: createQfcService(database, new FakeKrogerClient()),
    testMode: true
  });
  const apiServer = await new Promise<Server>((resolve, reject) => {
    const server = app.listen(apiPort, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });

  process.env.GROCERY_GETTER_API_URL = `http://127.0.0.1:${apiPort}`;
  let webServer: PreviewServer | null = null;
  try {
    await build({ configLoader: "native" });
    webServer = await preview({
      configLoader: "native",
      preview: { host: "127.0.0.1", port: webPort, strictPort: true }
    });
  } catch (error) {
    await closeHttpServer(apiServer);
    database.close();
    throw error;
  }

  return async () => {
    await webServer?.close();
    await closeHttpServer(apiServer);
    database.close();
  };
}
