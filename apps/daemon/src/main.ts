#!/usr/bin/env node
import { runLlmCommand, runOAuthCommand, runProfilesCommand, runSecretsCommand } from "./admin.ts";
import { loadConfig } from "./config.ts";
import { createLlmOAuth } from "./llm-oauth.ts";
import { createOAuthStore } from "./oauth.ts";
import { createFileSecretStore } from "./secret-store.ts";
import { serveDaemon } from "./serve.ts";

const [command = "serve", ...args] = process.argv.slice(2);
const config = loadConfig();
const secrets = createFileSecretStore(config.dataDir);
const llmOAuth = createLlmOAuth(config.dataDir);
const oauth = createOAuthStore(config.dataDir, secrets);

try {
  switch (command) {
    case "serve":
      await serveDaemon(config, { secrets, llmOAuth, oauth });
      break;
    case "secrets":
      await runSecretsCommand(secrets, args);
      break;
    case "llm":
      await runLlmCommand(llmOAuth, args);
      break;
    case "oauth":
      await runOAuthCommand(oauth, args);
      break;
    case "profiles":
      await runProfilesCommand(config, args);
      break;
    default:
      throw new Error(
        `unknown command "${command}", expected serve, secrets, llm, oauth, or profiles`,
      );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
