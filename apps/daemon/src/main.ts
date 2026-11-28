#!/usr/bin/env node
import { loadOrCreateAppToken } from "./servers/app/app-token.ts";
import { loadConfig } from "./config.ts";
import { createLlmOAuth } from "./credentials/llm-oauth.ts";
import { createOAuthStore } from "./credentials/oauth-store.ts";
import { createFileSecretStore } from "./credentials/secret-store.ts";
import { serveDaemon } from "./serve.ts";

const [command = "serve"] = process.argv.slice(2);
const config = loadConfig();
const secrets = createFileSecretStore(config.dataDir);
const llmOAuth = createLlmOAuth(config.dataDir);
const oauth = createOAuthStore(config.dataDir, secrets);

try {
  switch (command) {
    case "serve":
      await serveDaemon(config, { secrets, llmOAuth, oauth });
      break;
    case "app-token":
      console.log(loadOrCreateAppToken(config.dataDir));
      break;
    default:
      throw new Error(`unknown command "${command}", expected serve or app-token`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
