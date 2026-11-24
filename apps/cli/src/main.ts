#!/usr/bin/env node
import { Command } from "commander";
import { registerProfiles } from "./commands/profiles.ts";
import { registerSecrets } from "./commands/secrets.ts";
import { registerSetup } from "./commands/setup.ts";
import { registerSsh } from "./commands/ssh.ts";

const program = new Command("tetherbox").description("Install and operate a remote Tetherbox VM");

registerSetup(program);
registerSsh(program);
registerSecrets(program);
registerProfiles(program);

try {
  await program.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
