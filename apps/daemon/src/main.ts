#!/usr/bin/env node
import { runProfilesCommand, runSecretsCommand } from "./admin.ts";
import { loadConfig } from "./config.ts";
import { createFileSecretStore } from "./secret-store.ts";
import { serveDaemon } from "./serve.ts";

const [command = "serve", ...args] = process.argv.slice(2);
const config = loadConfig();
const secrets = createFileSecretStore(config.dataDir);

try {
  switch (command) {
    case "serve":
      await serveDaemon(config, secrets);
      break;
    case "secrets":
      await runSecretsCommand(secrets, args);
      break;
    case "profiles":
      await runProfilesCommand(config, args);
      break;
    default:
      throw new Error(`unknown command "${command}", expected serve, secrets, or profiles`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
