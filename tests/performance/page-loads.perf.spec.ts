import fs from "node:fs";
import os from "node:os";
import { expect, test, type Browser } from "playwright/test";

type Timing = {
  iteration: number;
  readyMs: number;
  domContentLoadedMs: number;
  loadMs: number;
  apiRequestCount: number;
  slowestApiMs: number;
};

type RouteResult = {
  name: string;
  path: string;
  heading: string;
  samples: Timing[];
  medianReadyMs: number;
  p95ReadyMs: number;
  minReadyMs: number;
  maxReadyMs: number;
};

const routes = [
  { name: "planner", path: "/planner", heading: "Menu Builder" },
  { name: "recipes", path: "/recipes/manage", heading: "Recipes" },
  { name: "shopping-lists", path: "/shopping-lists/manage", heading: "Shopping Lists" },
  { name: "ingredients", path: "/ingredients", heading: "Ingredients" }
] as const;

const warmupCount = Number(process.env.PERF_WARMUPS ?? 1);
const sampleCount = Number(process.env.PERF_SAMPLES ?? 3);
const baseUrl = process.env.PERF_BASE_URL ?? "http://127.0.0.1:5173";
const reportBase = process.env.PERF_REPORT_BASE;

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

async function measureRoute(browser: Browser, route: (typeof routes)[number], iteration: number) {
  const context = await browser.newContext();
  const page = await context.newPage();
  let apiRequestsSeen = 0;
  let apiRequestsInFlight = 0;
  let lastApiActivityAt = performance.now();
  page.on("request", (request) => {
    if (!request.url().includes("/api/")) return;
    apiRequestsSeen += 1;
    apiRequestsInFlight += 1;
    lastApiActivityAt = performance.now();
  });
  const finishApiRequest = (request: { url(): string }) => {
    if (!request.url().includes("/api/")) return;
    apiRequestsInFlight = Math.max(0, apiRequestsInFlight - 1);
    lastApiActivityAt = performance.now();
  };
  page.on("requestfinished", finishApiRequest);
  page.on("requestfailed", finishApiRequest);

  const startedAt = performance.now();
  const response = await page.goto(route.path, { waitUntil: "load", timeout: 30_000 });
  await expect(page.getByRole("heading", { name: route.heading, exact: true, level: 3 })).toBeVisible();
  await expect.poll(() => (
    apiRequestsSeen > 0
      && apiRequestsInFlight === 0
      && performance.now() - lastApiActivityAt >= 250
  ), {
    message: `${route.path} initial API requests to finish`,
    timeout: 30_000,
    intervals: [50, 100, 250]
  }).toBeTruthy();
  expect(apiRequestsSeen, `${route.path} should load API data`).toBeGreaterThan(0);
  const readyMs = round(performance.now() - startedAt);

  expect(response?.ok(), `${route.path} document response`).toBeTruthy();
  const browserTimings = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const apiResources = performance.getEntriesByType("resource")
      .filter((entry) => entry.name.includes("/api/"));
    return {
      domContentLoadedMs: navigation.domContentLoadedEventEnd,
      loadMs: navigation.loadEventEnd,
      apiRequestCount: apiResources.length,
      slowestApiMs: Math.max(0, ...apiResources.map((entry) => entry.duration))
    };
  });
  await context.close();

  return {
    iteration,
    readyMs,
    domContentLoadedMs: round(browserTimings.domContentLoadedMs),
    loadMs: round(browserTimings.loadMs),
    apiRequestCount: browserTimings.apiRequestCount,
    slowestApiMs: round(browserTimings.slowestApiMs)
  } satisfies Timing;
}

function renderMarkdown(report: {
  timestamp: string;
  label: string;
  baseUrl: string;
  gitCommit: string;
  warmupCount: number;
  sampleCount: number;
  routes: RouteResult[];
}) {
  const rows = report.routes.map((route) =>
    `| ${route.name} | ${route.medianReadyMs.toFixed(1)} | ${route.p95ReadyMs.toFixed(1)} | ${route.minReadyMs.toFixed(1)} | ${route.maxReadyMs.toFixed(1)} |`
  );
  return [
    `# Grocery Getter performance: ${report.label}`,
    "",
    `- Timestamp: ${report.timestamp}`,
    `- Target: ${report.baseUrl}`,
    `- Git commit: ${report.gitCommit}`,
    `- Browser: Chromium (Desktop Chrome profile)`,
    `- Host: ${os.platform()} ${os.release()} (${os.arch()})`,
    `- Samples: ${report.sampleCount} per route after ${report.warmupCount} warmup`,
    `- Ready condition: fresh browser context, expected page heading visible, and initial API activity quiet for 250 ms`,
    "",
    "| Route | Median ready (ms) | p95 (ms) | Min (ms) | Max (ms) |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...rows,
    "",
    "Full per-sample browser and API resource timings are available in the matching JSON report.",
    ""
  ].join("\n");
}

test("records page-load performance for representative routes", async ({ browser }) => {
  test.skip(!reportBase, "Run through npm run test:perf -- <label> so a report path is provided.");
  const results: RouteResult[] = [];

  for (const route of routes) {
    for (let index = 0; index < warmupCount; index += 1) {
      const warmup = await measureRoute(browser, route, -(index + 1));
      console.log(`${route.name} warmup ${index + 1}: ${warmup.readyMs.toFixed(1)} ms`);
    }

    const samples: Timing[] = [];
    for (let index = 0; index < sampleCount; index += 1) {
      const sample = await measureRoute(browser, route, index + 1);
      samples.push(sample);
      console.log(`${route.name} sample ${index + 1}: ${sample.readyMs.toFixed(1)} ms`);
    }
    const readyValues = samples.map((sample) => sample.readyMs);
    results.push({
      ...route,
      samples,
      medianReadyMs: percentile(readyValues, 0.5),
      p95ReadyMs: percentile(readyValues, 0.95),
      minReadyMs: Math.min(...readyValues),
      maxReadyMs: Math.max(...readyValues)
    });
  }

  const report = {
    timestamp: process.env.PERF_RUN_TIMESTAMP ?? new Date().toISOString(),
    label: process.env.PERF_RUN_LABEL ?? "local",
    baseUrl,
    gitCommit: process.env.PERF_GIT_COMMIT ?? "unknown",
    warmupCount,
    sampleCount,
    routes: results
  };
  fs.writeFileSync(`${reportBase}.json`, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(`${reportBase}.md`, renderMarkdown(report));

  console.log(`\nPerformance reports written to ${reportBase}.json and ${reportBase}.md`);
});
