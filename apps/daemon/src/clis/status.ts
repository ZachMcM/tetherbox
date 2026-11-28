import type { Starter, StarterCli, StarterCliStatus, StarterCliStatusEntry } from "@tetherbox/core";
import type { StarterCatalog } from "../profiles/starter-catalog.ts";
import type { AgentProcessRunner } from "./agent-process.ts";

export type BinaryProbeResult =
  | { readonly kind: "present" }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly message: string };

export async function probeBinary(
  runner: AgentProcessRunner,
  binary: string,
): Promise<BinaryProbeResult> {
  const result = await runner.capture([
    "sh",
    "-c",
    'if command -v "$1" >/dev/null 2>&1; then printf present; else printf missing; fi',
    "_",
    binary,
  ]);

  if (result.code === 0) {
    const output = result.stdout.trim();

    if (output === "present") {
      return { kind: "present" };
    }

    if (output === "missing") {
      return { kind: "missing" };
    }

    return {
      kind: "error",
      message: result.stderr.trim() || `unexpected probe output for "${binary}"`,
    };
  }

  return { kind: "error", message: result.stderr.trim() || `failed to check "${binary}"` };
}

async function inspectCli(runner: AgentProcessRunner, cli: StarterCli): Promise<StarterCliStatus> {
  const probe = await probeBinary(runner, cli.binary);

  switch (probe.kind) {
    case "missing":
      return { kind: "missing" };
    case "error":
      return { kind: "error", message: probe.message };
    case "present":
      break;
    default: {
      const exhaustive: never = probe;

      return exhaustive;
    }
  }

  if (cli.auth === undefined) {
    return { kind: "installed", auth: "none" };
  }

  if (cli.auth.checkCommand === undefined) {
    return { kind: "installed", auth: "unknown" };
  }

  const check = await runner.capture(cli.auth.checkCommand);

  return {
    kind: "installed",
    auth: check.code === 0 ? "authenticated" : "unauthenticated",
  };
}

export class CliStatusProbe {
  readonly #runner: AgentProcessRunner;
  readonly #catalog: StarterCatalog;

  constructor({ runner, catalog }: { runner: AgentProcessRunner; catalog: StarterCatalog }) {
    this.#runner = runner;
    this.#catalog = catalog;
  }

  async list(): Promise<StarterCliStatusEntry[]> {
    const cliStarters: readonly (Starter & { readonly cli: StarterCli })[] = this.#catalog
      .all()
      .flatMap((starter) => (starter.cli === undefined ? [] : [{ ...starter, cli: starter.cli }]));

    return Promise.all(
      cliStarters.map(async (starter) => ({
        starterId: starter.id,
        name: starter.name,
        binary: starter.cli.binary,
        hasInstall: starter.cli.install !== undefined,
        ...(starter.cli.install !== undefined
          ? { installDescription: starter.cli.install.description }
          : {}),
        hasAuth: starter.cli.auth !== undefined,
        status: await inspectCli(this.#runner, starter.cli),
      })),
    );
  }
}
