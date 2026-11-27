#!/usr/bin/env node
import { Command } from "commander";
import { registerProfiles } from "./commands/profiles.ts";
import { registerSetup } from "./commands/setup.ts";
import { registerSsh } from "./commands/ssh.ts";

const program = new Command("tetherbox")
  .description("Install and operate a remote Tetherbox VM")
  .enablePositionalOptions();

registerSetup(program);
registerSsh(program);
registerProfiles(program);

try {
  await program.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
