#!/usr/bin/env node
import { runLlmCommand, runProfilesCommand, runSecretsCommand } from "./admin.ts";
import { loadConfig } from "./config.ts";
import { createLlmOAuth } from "./llm-oauth.ts";
import { createFileSecretStore } from "./secret-store.ts";
import { serveDaemon } from "./serve.ts";

const [command = "serve", ...args] = process.argv.slice(2);
const config = loadConfig();
const secrets = createFileSecretStore(config.dataDir);
const llmOAuth = createLlmOAuth(config.dataDir);

try {
  switch (command) {
    case "serve":
      await serveDaemon(config, { secrets, llmOAuth });
      break;
    case "secrets":
      await runSecretsCommand(secrets, args);
      break;
    case "llm":
      await runLlmCommand(llmOAuth, args);
      break;
    case "profiles":
      await runProfilesCommand(config, args);
      break;
    default:
      throw new Error(`unknown command "${command}", expected serve, secrets, llm, or profiles`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
