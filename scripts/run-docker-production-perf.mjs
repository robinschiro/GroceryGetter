import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDatabase = path.join(projectRoot, "data", "grocery-getter.sqlite");
const temporaryRoot = path.join(
  projectRoot,
  ".cache",
  "performance",
  `docker-production-${process.pid}`
);
const temporaryData = path.join(temporaryRoot, "data");
const composeProject = `grocerygetter-perf-${process.pid}`;
const webPort = process.env.PERF_DOCKER_PORT ?? "5183";
const composeEnvironment = {
  ...process.env,
  GROCERY_GETTER_DATA_DIR: temporaryData,
  GROCERY_GETTER_WEB_PORT: webPort
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: composeEnvironment,
    encoding: "utf8",
    windowsHide: true,
    stdio: options.capture ? "pipe" : "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const details = options.capture ? `\n${result.stdout}${result.stderr}` : "";
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.${details}`);
  }
  return result;
}

fs.mkdirSync(temporaryData, { recursive: true });
if (fs.existsSync(sourceDatabase)) {
  fs.copyFileSync(sourceDatabase, path.join(temporaryData, "grocery-getter.sqlite"));
}

let exitCode = 1;
try {
  console.log(`Starting isolated production stack on http://127.0.0.1:${webPort} ...`);
  run("docker", [
    "compose",
    "--project-name",
    composeProject,
    "up",
    "--build",
    "--detach",
    "--wait",
    "--wait-timeout",
    "120"
  ]);

  const benchmark = spawnSync(process.execPath, ["scripts/run-perf.mjs", "docker-production"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PERF_BASE_URL: `http://127.0.0.1:${webPort}`
    },
    stdio: "inherit",
    windowsHide: true
  });
  if (benchmark.error) throw benchmark.error;
  exitCode = benchmark.status ?? 1;
} finally {
  console.log("Stopping isolated production stack ...");
  run("docker", ["compose", "--project-name", composeProject, "down"], { allowFailure: true });
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

process.exitCode = exitCode;
