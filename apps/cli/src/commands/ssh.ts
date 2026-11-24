import type { Command } from "commander";
import { readConfig } from "../config.ts";
import { runRemote } from "../remote.ts";

export function registerSsh(program: Command): void {
  program
    .command("ssh")
    .description("Open a shell on the Tetherbox VM, or run a command there")
    .argument("[command...]", "command to run instead of a shell")
    .action(async (command: string[]) => {
      const { sshAlias } = await readConfig();

      process.exitCode = await runRemote(sshAlias, command, { interactive: true });
    });
}
