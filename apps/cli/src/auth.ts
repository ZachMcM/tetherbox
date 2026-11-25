import * as p from "@clack/prompts";
import type { StarterCliAuth, StarterCliAuthEntry } from "@tetherbox/starters";
import pc from "picocolors";
import { captureAgentCommand, runAgentCommand } from "./remote.ts";

export type CliAuthStatus =
  | { readonly kind: "authenticated" }
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "unknown" }
  | { readonly kind: "missing-binary"; readonly binary: string }
  | { readonly kind: "error"; readonly message: string };

const SSH_ERROR_EXIT_CODE = 255;

const LOGIN_GUARD_SCRIPT = [
  'if ! command -v "$1" >/dev/null 2>&1; then',
  `  printf '%s is not installed on the VM for tetherbox-agent. Install it first, then re-run "tetherbox auth %s".\\n' "$1" "$2" >&2`,
  "  exit 127",
  "fi",
  "shift 2",
  'exec "$@"',
].join("\n");

export async function inspectCliAuth(
  sshAlias: string,
  cliAuth: StarterCliAuth,
): Promise<CliAuthStatus> {
  const probe = await captureAgentCommand(sshAlias, [
    "sh",
    "-c",
    'if command -v "$1" >/dev/null 2>&1; then printf present; else printf missing; fi',
    "_",
    cliAuth.binary,
  ]);

  if (probe.code === 0) {
    const output = probe.stdout.trim();

    if (output === "missing") {
      return { kind: "missing-binary", binary: cliAuth.binary };
    }

    if (output !== "present") {
      return {
        kind: "error",
        message: probe.stderr.trim() || `unexpected probe output for "${cliAuth.binary}"`,
      };
    }
  } else {
    const fallback =
      probe.code === SSH_ERROR_EXIT_CODE
        ? "failed to reach the VM over SSH"
        : `failed to check "${cliAuth.binary}" on the VM`;

    return { kind: "error", message: probe.stderr.trim() || fallback };
  }

  if (cliAuth.checkCommand === undefined) {
    return { kind: "unknown" };
  }

  const check = await captureAgentCommand(sshAlias, cliAuth.checkCommand);

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

function execStarterLogin(sshAlias: string, entry: StarterCliAuthEntry): Promise<number> {
  const command = entry.cliAuth.loginCommand;

  p.log.info(`Running ${pc.cyan(command.join(" "))} as tetherbox-agent...`);

  return runAgentCommand(sshAlias, command, { interactive: true });
}

export interface RunStarterLoginOptions {
  readonly sshAlias: string;
  readonly entry: StarterCliAuthEntry;
  readonly extraArgs?: readonly string[];
}

export function runStarterLogin({
  sshAlias,
  entry,
  extraArgs = [],
}: RunStarterLoginOptions): Promise<number> {
  const command = [...entry.cliAuth.loginCommand, ...extraArgs];

  p.log.info(`Running ${pc.cyan(command.join(" "))} as tetherbox-agent...`);

  return runAgentCommand(
    sshAlias,
    ["sh", "-c", LOGIN_GUARD_SCRIPT, "_", entry.cliAuth.binary, entry.starterId, ...command],
    { interactive: true },
  );
}

export interface EnsureStarterCliAuthOptions {
  readonly sshAlias: string;
  readonly entries: readonly StarterCliAuthEntry[];
}

export async function ensureStarterCliAuth({
  sshAlias,
  entries,
}: EnsureStarterCliAuthOptions): Promise<"ok" | "cancelled"> {
  for (const entry of entries) {
    const status = await inspectCliAuth(sshAlias, entry.cliAuth);

    switch (status.kind) {
      case "authenticated":
        p.log.success(`${entry.starterId} CLI is already authenticated.`);
        continue;
      case "missing-binary":
        p.log.warn(
          `${status.binary} is not installed on the VM for tetherbox-agent. Install it later and run "tetherbox auth ${entry.starterId}".`,
        );
        continue;
      case "error":
        p.log.warn(
          `Could not check ${entry.starterId} CLI auth (${status.message}). You can run "tetherbox auth ${entry.starterId}" later.`,
        );
        continue;
      case "unauthenticated":
      case "unknown":
        break;
      default: {
        const exhaustive: never = status;

        return exhaustive;
      }
    }

    const promptMessage =
      status.kind === "unauthenticated"
        ? `${entry.starterId} CLI is not authenticated. Log in now?`
        : `Run ${entry.starterId} CLI login now?`;
    const shouldLogin = await p.confirm({
      message: promptMessage,
      initialValue: status.kind === "unauthenticated",
    });

    if (p.isCancel(shouldLogin)) {
      return "cancelled";
    }

    if (!shouldLogin) {
      p.log.info(`Skipped. Authenticate later with: tetherbox auth ${entry.starterId}`);
      continue;
    }

    const code = await execStarterLogin(sshAlias, entry);

    if (code !== 0) {
      p.log.warn(
        `${entry.starterId} login exited with code ${code}. Retry later with: tetherbox auth ${entry.starterId}`,
      );
    }
  }

  return "ok";
}
