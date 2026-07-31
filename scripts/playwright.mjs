import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browserPath = path.join(projectRoot, ".cache", "ms-playwright");
const playwrightCli = path.join(projectRoot, "node_modules", "playwright", "cli.js");
const result = spawnSync(process.execPath, [playwrightCli, ...process.argv.slice(2)], {
  cwd: projectRoot,
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: browserPath
  },
  stdio: "inherit"
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
