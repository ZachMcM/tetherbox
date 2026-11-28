import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const composeFile = resolve(repoRoot, "docker/dev/compose.yaml");
const appPort = process.env.TETHERBOX_DEV_APP_PORT?.trim() || "8788";
const apiTarget = process.env.VITE_API_TARGET?.trim() || `http://127.0.0.1:${appPort}`;

function runStep(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

runStep("pnpm", ["--filter", "@tetherbox/core", "build"]);
runStep("docker", ["compose", "-f", composeFile, "up", "--build", "-d"]);

const logs = spawn("docker", ["compose", "-f", composeFile, "logs", "-f", "--tail=50", "daemon"], {
  cwd: repoRoot,
  stdio: "inherit",
});

const web = spawn("pnpm", ["--filter", "@tetherbox/web", "dev"], {
  cwd: repoRoot,
  env: { ...process.env, VITE_API_TARGET: apiTarget },
  stdio: "inherit",
});

let shuttingDown = false;

function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logs.kill("SIGTERM");
  web.kill("SIGTERM");
  spawnSync("docker", ["compose", "-f", composeFile, "stop", "daemon"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  process.exit(exitCode);
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

logs.once("error", (error) => {
  console.error(error.message);
  shutdown(1);
});

web.once("error", (error) => {
  console.error(error.message);
  shutdown(1);
});

web.once("exit", (code, signal) => {
  shutdown(code ?? (signal !== null ? 1 : 0));
});
