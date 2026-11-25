import * as p from "@clack/prompts";
import {
  getCliAuthStarter,
  listCliAuthStarters,
  type StarterCliAuthEntry,
} from "@tetherbox/starters";
import type { Command } from "commander";
import pc from "picocolors";
import { formatCliAuthStatus, inspectCliAuth, runStarterLogin } from "../auth.ts";
import { readConfig } from "../config.ts";
import { runAgentCommand } from "../remote.ts";

function supportedStarterIds(): string {
  return listCliAuthStarters()
    .map((entry) => entry.starterId)
    .join(", ");
}

export function registerAuth(program: Command): void {
  const auth = program
    .command("auth")
    .description("Authenticate external CLIs on the VM as the tetherbox-agent user")
    .enablePositionalOptions()
    .argument("[starter]", `starter CLI to authenticate (${supportedStarterIds()})`)
    .argument("[args...]", "extra flags forwarded to the login command after --")
    .action(async (starterId: string | undefined, extraArgs: string[]) => {
      const { sshAlias } = await readConfig();
      let entry: StarterCliAuthEntry;

      if (starterId === undefined) {
        const picked = await p.select({
          message: "Select a CLI starter to authenticate",
          options: listCliAuthStarters().map((candidate) => ({
            value: candidate,
            label: candidate.starterId,
            hint: candidate.cli.auth.loginCommand.join(" "),
          })),
        });

        if (p.isCancel(picked)) {
          p.cancel("Authentication cancelled.");

          return;
        }

        entry = picked;
      } else {
        const resolved = getCliAuthStarter(starterId);

        if (resolved === undefined) {
          console.error(
            `Unknown CLI auth starter "${starterId}". Supported starters: ${supportedStarterIds()}. For custom CLIs, run: tetherbox auth exec -- <command...>`,
          );
          process.exitCode = 1;

          return;
        }

        entry = resolved;
      }

      process.exitCode = await runStarterLogin({ sshAlias, entry, extraArgs });
    });

  auth
    .command("status")
    .description("Check installation and login status for CLI starters on the VM")
    .argument("[starter]", "limit status check to one starter")
    .action(async (starterId: string | undefined) => {
      const { sshAlias } = await readConfig();
      let entries: StarterCliAuthEntry[];

      if (starterId === undefined) {
        entries = listCliAuthStarters();
      } else {
        const resolved = getCliAuthStarter(starterId);

        if (resolved === undefined) {
          console.error(
            `Unknown CLI auth starter "${starterId}". Supported starters: ${supportedStarterIds()}.`,
          );
          process.exitCode = 1;

          return;
        }

        entries = [resolved];
      }

      for (const entry of entries) {
        const status = await inspectCliAuth(sshAlias, entry.cli);

        console.log(`${pc.bold(entry.starterId)}\t${formatCliAuthStatus(status)}`);
      }
    });

  auth
    .command("exec")
    .description("Run an interactive CLI login command as tetherbox-agent")
    .passThroughOptions()
    .allowUnknownOption()
    .argument("<command...>", "command to run as tetherbox-agent")
    .action(async (command: string[]) => {
      const { sshAlias } = await readConfig();

      process.exitCode = await runAgentCommand(sshAlias, command, { interactive: true });
    });
}
