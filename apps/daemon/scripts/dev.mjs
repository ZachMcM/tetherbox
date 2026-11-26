import { spawn } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../..");
const localRoot = resolve(repoRoot, ".local");

function envOrDefault(name, fallback) {
  const value = process.env[name]?.trim();

  return value ? value : fallback;
}

const env = {
  ...process.env,
  TETHERBOX_DATA_DIR: envOrDefault("TETHERBOX_DATA_DIR", resolve(localRoot, "data")),
  TETHERBOX_PROFILES_DIR: envOrDefault("TETHERBOX_PROFILES_DIR", resolve(localRoot, "profiles")),
  TETHERBOX_SESSIONS_DIR: envOrDefault("TETHERBOX_SESSIONS_DIR", resolve(localRoot, "sessions")),
  TETHERBOX_SOCKET: envOrDefault("TETHERBOX_SOCKET", resolve(localRoot, "internal.sock")),
  TETHERBOX_AGENT_ENTRY: envOrDefault(
    "TETHERBOX_AGENT_ENTRY",
    resolve(repoRoot, "apps/agent/src/main.ts"),
  ),
};

console.log(`local dev data dir: ${env.TETHERBOX_DATA_DIR}`);
console.log(`app token file: ${resolve(env.TETHERBOX_DATA_DIR, "app-token")}`);

const child = spawn(process.execPath, ["--watch", "src/main.ts", "serve"], {
  cwd: resolve(import.meta.dirname, ".."),
  env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on("exit", (code, signal) => {
  if (code !== null) {
    process.exitCode = code;

    return;
  }

  process.exitCode = signal !== null ? 1 : 0;
});
