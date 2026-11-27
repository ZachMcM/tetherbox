import { profileIdSchema } from "@tetherbox/core";
import type { Command } from "commander";
import { readConfig } from "../config.ts";
import { runDaemonCommand } from "../remote.ts";

export function registerProfiles(program: Command): void {
  const profiles = program.command("profiles").description("Inspect and reload profiles on the VM");

  profiles
    .command("list")
    .description("List profiles on the VM")
    .action(async () => {
      const { sshAlias } = await readConfig();

      process.exitCode = await runDaemonCommand(sshAlias, ["profiles", "list"]);
    });

  profiles
    .command("validate")
    .description("Check a profile's config, cron, and webhook files")
    .argument("<id>", "profile id")
    .action(async (rawId: string) => {
      const id = profileIdSchema.parse(rawId);
      const { sshAlias } = await readConfig();

      process.exitCode = await runDaemonCommand(sshAlias, ["profiles", "validate", id]);
    });

  profiles
    .command("reload")
    .description("Reload profiles and cron schedules in the running daemon")
    .action(async () => {
      const { sshAlias } = await readConfig();

      process.exitCode = await runDaemonCommand(sshAlias, ["profiles", "reload"]);
    });
}
