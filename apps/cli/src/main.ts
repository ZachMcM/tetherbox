#!/usr/bin/env node
import { Command } from "commander";
import { registerAuth } from "./commands/auth.ts";
import { registerLlm } from "./commands/llm.ts";
import { registerOAuth } from "./commands/oauth.ts";
import { registerProfiles } from "./commands/profiles.ts";
import { registerSecrets } from "./commands/secrets.ts";
import { registerSetup } from "./commands/setup.ts";
import { registerSsh } from "./commands/ssh.ts";

const program = new Command("tetherbox")
  .description("Install and operate a remote Tetherbox VM")
  .enablePositionalOptions();

registerSetup(program);
registerSsh(program);
registerAuth(program);
registerLlm(program);
registerOAuth(program);
registerSecrets(program);
registerProfiles(program);

try {
  await program.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
