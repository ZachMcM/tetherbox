import { spawn } from "node:child_process";
import * as p from "@clack/prompts";
import type { Command } from "commander";
import ora from "ora";
import pc from "picocolors";
import { writeConfig } from "../config.ts";

function canConnect(alias: string): Promise<boolean> {
  const child = spawn("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", alias, "true"], {
    stdio: "ignore",
  });

  return new Promise((resolve) => {
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

export function registerSetup(program: Command): void {
  program
    .command("setup")
    .description("Connect to a Linux VM over an SSH alias and install Tetherbox on it")
    .action(async () => {
      p.intro(pc.bold("tetherbox setup"));

      const alias = await p.text({
        message: "SSH alias for your VM (from ~/.ssh/config)",
        validate: (value) => (value?.trim() ? undefined : "An SSH alias is required"),
      });

      if (p.isCancel(alias)) {
        p.cancel("Setup cancelled.");

        return;
      }

      const spinner = ora(`Connecting to ${alias}`).start();

      if (!(await canConnect(alias))) {
        spinner.fail(`Could not connect with "ssh ${alias}". Check your SSH config and keys.`);
        process.exitCode = 1;

        return;
      }

      spinner.succeed(`Connected to ${alias}`);
      await writeConfig({ sshAlias: alias });

      // TODO: Provision the VM: install Node 24, create the tetherbox (daemon) and tetherbox-agent
      // users plus a shared socket group, lay out /var/lib/tetherbox and /srv/tetherbox/profiles,
      // install the daemon and agent builds, the sudoers rule for agent runs, a systemd unit, and
      // Tailscale Funnel for the public server. Then prompt for the Slack app and bot tokens.
      p.outro(`Saved ${pc.cyan(alias)}. VM provisioning is not implemented yet.`);
    });
}
