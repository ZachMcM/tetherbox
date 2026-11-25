import * as p from "@clack/prompts";
import type { StarterCli, StarterCliAuthEntry } from "@tetherbox/starters";
import pc from "picocolors";
import { ensureCliInstalled, probeAgentBinary, SSH_ERROR_EXIT_CODE } from "./cli-install.ts";
import { captureAgentCommand, runAgentCommand } from "./remote.ts";

export type CliAuthStatus =
  | { readonly kind: "authenticated" }
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "unknown" }
  | { readonly kind: "missing-binary"; readonly binary: string }
  | { readonly kind: "error"; readonly message: string };

export async function inspectCliAuth(sshAlias: string, cli: StarterCli): Promise<CliAuthStatus> {
  const probe = await probeAgentBinary(sshAlias, cli.binary);

  if (probe.kind === "missing") {
    return { kind: "missing-binary", binary: probe.binary };
  }

  if (probe.kind === "error") {
    return { kind: "error", message: probe.message };
  }

  if (cli.auth?.checkCommand === undefined) {
    return { kind: "unknown" };
  }

  const check = await captureAgentCommand(sshAlias, cli.auth.checkCommand);

  if (check.code === 0) {
    return { kind: "authenticated" };
  }

  if (check.code === SSH_ERROR_EXIT_CODE) {
    return { kind: "error", message: check.stderr.trim() || "failed to reach the VM over SSH" };
  }

  return { kind: "unauthenticated" };
}

export function formatCliAuthStatus(status: CliAuthStatus): string {
  switch (status.kind) {
    case "authenticated":
      return pc.green("authenticated");
    case "unauthenticated":
      return pc.yellow("not authenticated");
    case "unknown":
      return pc.dim("installed (auth status not checked)");
    case "missing-binary":
      return pc.red(`binary "${status.binary}" not installed`);
    case "error":
      return pc.red(`error: ${status.message}`);
    default: {
      const exhaustive: never = status;

      return exhaustive;
    }
  }
}

export function execLoginCommand(
  sshAlias: string,
  loginCommand: readonly [string, ...string[]],
  extraArgs: readonly string[] = [],
): Promise<number> {
  const command = [...loginCommand, ...extraArgs];

  p.log.info(`Running ${pc.cyan(command.join(" "))} as tetherbox-agent...`);

  return runAgentCommand(sshAlias, command, { interactive: true });
}

export interface RunStarterLoginOptions {
  readonly sshAlias: string;
  readonly entry: StarterCliAuthEntry;
  readonly extraArgs?: readonly string[];
}

export async function runStarterLogin({
  sshAlias,
  entry,
  extraArgs = [],
}: RunStarterLoginOptions): Promise<number> {
  const installState = await ensureCliInstalled(sshAlias, entry.starterId, entry.cli);

  if (installState === "cancelled") {
    return 0;
  }

  if (installState !== "ready") {
    return 127;
  }

  return execLoginCommand(sshAlias, entry.cli.auth.loginCommand, extraArgs);
}
