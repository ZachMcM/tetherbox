import type { Command } from "commander";
import { readConfig } from "../config.ts";
import { runDaemonCommand } from "../remote.ts";

export function registerProfiles(program: Command): void {
  const profiles = program.command("profiles").description("Manage Tetherbox profiles on the VM");

  profiles
    .command("list")
    .description("List profiles and the Slack channels they map to")
    .action(async () => {
      const { sshAlias } = await readConfig();

      process.exitCode = await runDaemonCommand(sshAlias, ["profiles", "list"]);
    });

  profiles
    .command("validate")
    .description("Check a profile's config, cron, webhook, and poll files")
    .argument("<id>", "profile id")
    .action(async (id: string) => {
      const { sshAlias } = await readConfig();

      process.exitCode = await runDaemonCommand(sshAlias, ["profiles", "validate", id]);
    });

  profiles
    .command("create")
    .description("Create a profile for a Slack channel or DM")
    .argument("<id>", "profile id")
    .action(async (id: string) => {
      const { sshAlias } = await readConfig();

      // TODO: Prompt for the profile name, Slack channel, model, and starters with @clack/prompts,
      // then pass them to the daemon's profiles create command.
      process.exitCode = await runDaemonCommand(sshAlias, ["profiles", "create", id]);
    });
}
