import * as p from "@clack/prompts";
import type { StarterCli, StarterCliInstall } from "@tetherbox/starters";
import pc from "picocolors";
import { captureAgentCommand, runAgentCommand, runRemote } from "./remote.ts";

export const SSH_ERROR_EXIT_CODE = 255;

type BinaryProbeResult =
  | { readonly kind: "present" }
  | { readonly kind: "missing"; readonly binary: string }
  | { readonly kind: "error"; readonly message: string };

type CliInstallOutcome = "installed" | "skipped" | "failed" | "cancelled";

export async function probeAgentBinary(
  sshAlias: string,
  binary: string,
): Promise<BinaryProbeResult> {
  const probe = await captureAgentCommand(sshAlias, [
    "sh",
    "-c",
    'if command -v "$1" >/dev/null 2>&1; then printf present; else printf missing; fi',
    "_",
    binary,
  ]);

  if (probe.code === 0) {
    const output = probe.stdout.trim();

    if (output === "present") {
      return { kind: "present" };
    }

    if (output === "missing") {
      return { kind: "missing", binary };
    }

    return {
      kind: "error",
      message: probe.stderr.trim() || `unexpected probe output for "${binary}"`,
    };
  }

  const fallback =
    probe.code === SSH_ERROR_EXIT_CODE
      ? "failed to reach the VM over SSH"
      : `failed to check "${binary}" on the VM`;

  return { kind: "error", message: probe.stderr.trim() || fallback };
}

function runInstallCommand(sshAlias: string, install: StarterCliInstall): Promise<number> {
  switch (install.target) {
    case "agent":
      return runAgentCommand(sshAlias, install.command, { interactive: true });
    case "system":
      return runRemote(sshAlias, install.command, { interactive: true });
    default: {
      const exhaustive: never = install.target;

      return exhaustive;
    }
  }
}

async function promptInstallCli(
  sshAlias: string,
  starterId: string,
  cli: StarterCli,
): Promise<CliInstallOutcome> {
  if (cli.install === undefined) {
    const retryHint = cli.auth === undefined ? "" : ` Then run "tetherbox auth ${starterId}".`;

    p.log.warn(
      `${cli.binary} is not installed on the VM for tetherbox-agent. Install it on the VM first.${retryHint}`,
    );

    return "skipped";
  }

  const shouldInstall = await p.confirm({
    message: `${cli.binary} is not installed on the VM. ${cli.install.description} now?`,
    initialValue: true,
  });

  if (p.isCancel(shouldInstall)) {
    return "cancelled";
  }

  if (!shouldInstall) {
    p.log.info(
      cli.auth === undefined
        ? `Skipped installing ${cli.binary}.`
        : `Skipped. Install ${cli.binary} later or re-run: tetherbox auth ${starterId}`,
    );

    return "skipped";
  }

  p.log.info(`Installing ${pc.cyan(cli.binary)} on the VM...`);

  const code = await runInstallCommand(sshAlias, cli.install);

  if (code !== 0) {
    p.log.warn(`${cli.binary} install exited with code ${code}.`);

    return "failed";
  }

  p.log.success(`Installed ${cli.binary}.`);

  return "installed";
}

export async function ensureCliInstalled(
  sshAlias: string,
  starterId: string,
  cli: StarterCli,
): Promise<"ready" | "skipped" | "failed" | "cancelled"> {
  const probe = await probeAgentBinary(sshAlias, cli.binary);

  switch (probe.kind) {
    case "present":
      return "ready";
    case "error":
      p.log.warn(`Could not check ${starterId} CLI (${probe.message}).`);

      return "failed";
    case "missing": {
      const outcome = await promptInstallCli(sshAlias, starterId, cli);

      return outcome === "installed" ? "ready" : outcome;
    }
    default: {
      const exhaustive: never = probe;

      return exhaustive;
    }
  }
}
