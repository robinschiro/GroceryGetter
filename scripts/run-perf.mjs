import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browserPath = path.join(projectRoot, ".cache", "ms-playwright");
const playwrightCli = path.join(projectRoot, "node_modules", "playwright", "cli.js");
const target = process.argv[2] ?? "local";
const safeTarget = target.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "run";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportDirectory = path.join(projectRoot, "reports", "performance");
const reportBase = path.join(reportDirectory, `${timestamp}-${safeTarget}`);
const baseUrl = process.env.PERF_BASE_URL ?? "http://127.0.0.1:5173";

fs.mkdirSync(reportDirectory, { recursive: true });

const gitResult = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: projectRoot,
  encoding: "utf8",
  windowsHide: true
});
const gitCommit = gitResult.status === 0 ? gitResult.stdout.trim() : "unknown";

console.log(`Performance target: ${target}`);
console.log(`Base URL: ${baseUrl}`);
console.log(`Report base: ${reportBase}`);

const result = spawnSync(process.execPath, [playwrightCli, "test", "--config", "playwright.perf.config.ts"], {
  cwd: projectRoot,
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: browserPath,
    PERF_BASE_URL: baseUrl,
    PERF_GIT_COMMIT: gitCommit,
    PERF_REPORT_BASE: reportBase,
    PERF_RUN_LABEL: target,
    PERF_RUN_TIMESTAMP: new Date().toISOString()
  },
  stdio: "inherit"
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
