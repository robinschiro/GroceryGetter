import { defineConfig, devices } from "playwright/test";

const apiUrl = "http://127.0.0.1:5194";
const webUrl = "http://127.0.0.1:5193";

export default defineConfig({
  testDir: "./tests",
  outputDir: ".cache/tests/results",
  globalSetup: "./tests/fixtures/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: webUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "api",
      testMatch: /tests\/api\/.*\.spec\.ts/,
      use: { baseURL: apiUrl }
    },
    {
      name: "chromium",
      testMatch: /tests\/e2e\/desktop\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "mobile-smoke",
      testMatch: /tests\/e2e\/mobile\/.*\.spec\.ts/,
      use: { ...devices["Pixel 7"] }
    }
  ]
});
