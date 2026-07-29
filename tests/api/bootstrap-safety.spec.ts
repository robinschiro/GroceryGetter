import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "playwright/test";
import { productionHeaders, resetDatabase } from "../fixtures/characterization.js";

test.beforeEach(async ({ request }) => {
  await resetDatabase(request);
});

test("test startup refuses the production database and test controls expose only the intended method", async ({
  request
}) => {
  const environment = { ...process.env, GROCERY_GETTER_TEST_MODE: "1", PORT: "5195" };
  delete environment.GROCERY_GETTER_DB_PATH;
  const result = spawnSync(
    process.execPath,
    [path.resolve("node_modules", "tsx", "dist", "cli.mjs"), path.resolve("server", "index.ts")],
    {
      cwd: process.cwd(),
      env: environment,
      encoding: "utf8",
      timeout: 10_000
    }
  );
  expect(result.status).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toContain(
    "GROCERY_GETTER_TEST_MODE=1 refuses to use the production grocery database"
  );

  const wrongMethod = await request.get("/api/test/reset", { headers: productionHeaders });
  expect(wrongMethod.status()).toBe(404);
});
