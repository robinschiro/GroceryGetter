import { defineConfig, devices } from "playwright/test";

export default defineConfig({
  testDir: "./tests/performance",
  outputDir: ".cache/tests/performance-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 900_000,
  use: {
    baseURL: process.env.PERF_BASE_URL ?? "http://127.0.0.1:5173",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "performance",
      testMatch: /.*\.perf\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
