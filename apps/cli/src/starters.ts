import * as p from "@clack/prompts";
import {
  starterConfigFieldSchemas,
  type SecretBinding,
  type SecretKey,
  type StarterConfig,
} from "@tetherbox/core";
import {
  collectStarterClis,
  collectStarterConfigFields,
  collectStarterOAuthPresets,
  collectStarterSecrets,
  resolveStarters,
  type StarterCliEntry,
  type StarterConfigEntry,
  type StarterConfigField,
} from "@tetherbox/starters";
import { execLoginCommand, inspectCliAuth } from "./auth.ts";
import { ensureCliInstalled } from "./cli-install.ts";
import { ensureStarterOAuth } from "./oauth.ts";
import { ensureRequiredSecrets } from "./secrets.ts";

function validateStarterConfigValue(
  field: StarterConfigField,
  rawValue: string | undefined,
): string | undefined {
  const result = starterConfigFieldSchemas[field.kind].safeParse(rawValue ?? "");

  return result.success ? undefined : (result.error.issues[0]?.message ?? "Invalid value");
}

async function promptStarterConfig(
  entries: readonly StarterConfigEntry[],
): Promise<StarterConfig | undefined> {
  const config: Record<string, Record<string, string>> = {};

  for (const { starterId, field } of entries) {
    const rawValue = await p.text({
      message: field.prompt,
      placeholder: field.placeholder,
      validate: (value) => validateStarterConfigValue(field, value),
    });

    if (p.isCancel(rawValue)) {
      return undefined;
    }

    config[starterId] ??= {};
    config[starterId][field.key] = starterConfigFieldSchemas[field.kind].parse(rawValue);
  }

  return config;
}

export function starterConfigArgs(config: StarterConfig): string[] {
  const args: string[] = [];

  for (const [starterId, fields] of Object.entries(config)) {
    for (const [key, value] of Object.entries(fields)) {
      args.push(`--starter-config=${starterId}.${key}=${value}`);
    }
  }

  return args;
}

async function ensureStarterClis(
  sshAlias: string,
  entries: readonly StarterCliEntry[],
): Promise<"ok" | "cancelled"> {
  for (const entry of entries) {
    const installState = await ensureCliInstalled(sshAlias, entry.starterId, entry.cli);

    if (installState === "cancelled") {
      return "cancelled";
    }

    if (installState !== "ready") {
      continue;
    }

    if (entry.cli.auth === undefined) {
      p.log.success(`${entry.starterId} CLI (${entry.cli.binary}) is installed.`);
      continue;
    }

    const authStatus = await inspectCliAuth(sshAlias, entry.cli);

    switch (authStatus.kind) {
      case "authenticated":
        p.log.success(`${entry.starterId} CLI is already authenticated.`);
        continue;
      case "missing-binary":
        p.log.warn(
          `${authStatus.binary} is still not on PATH for tetherbox-agent after install. Check ~/.local/bin on the VM.`,
        );
        continue;
      case "error":
        p.log.warn(`Could not check ${entry.starterId} CLI auth (${authStatus.message}).`);
        continue;
      case "unauthenticated":
      case "unknown":
        break;
      default: {
        const exhaustive: never = authStatus;

        return exhaustive;
      }
    }

    const promptMessage =
      authStatus.kind === "unauthenticated"
        ? `${entry.starterId} CLI is not authenticated. Log in now?`
        : `Run ${entry.starterId} CLI login now?`;
    const shouldLogin = await p.confirm({
      message: promptMessage,
      initialValue: authStatus.kind === "unauthenticated",
    });

    if (p.isCancel(shouldLogin)) {
      return "cancelled";
    }

    if (!shouldLogin) {
      p.log.info(`Skipped. Authenticate later with: tetherbox auth ${entry.starterId}`);
      continue;
    }

    const code = await execLoginCommand(sshAlias, entry.cli.auth.loginCommand);

    if (code !== 0) {
      p.log.warn(
        `${entry.starterId} login exited with code ${code}. Retry later with: tetherbox auth ${entry.starterId}`,
      );
    }
  }

  return "ok";
}

export interface EnsureStarterSetupOptions {
  readonly sshAlias: string;
  readonly starterIds: readonly string[];
  readonly existingSecrets: Map<SecretKey, SecretBinding>;
}

export async function ensureStarterSetup({
  sshAlias,
  starterIds,
  existingSecrets,
}: EnsureStarterSetupOptions): Promise<
  { readonly kind: "ok"; readonly starterConfig: StarterConfig } | { readonly kind: "cancelled" }
> {
  const starterConfig = await promptStarterConfig(collectStarterConfigFields(starterIds));

  if (starterConfig === undefined) {
    return { kind: "cancelled" };
  }

  const secretStatus = await ensureRequiredSecrets({
    sshAlias,
    required: collectStarterSecrets(starterIds),
    existing: existingSecrets,
    starterConfig,
  });

  if (secretStatus === "cancelled") {
    return { kind: "cancelled" };
  }

  const oauthStatus = await ensureStarterOAuth({
    sshAlias,
    presetIds: collectStarterOAuthPresets(starterIds),
    existingSecrets,
  });

  if (oauthStatus === "cancelled") {
    return { kind: "cancelled" };
  }

  const cliStatus = await ensureStarterClis(sshAlias, collectStarterClis(starterIds));

  if (cliStatus === "cancelled") {
    return { kind: "cancelled" };
  }

  for (const starter of resolveStarters(starterIds)) {
    if (starter.setupNote !== undefined) {
      p.log.info(`${starter.id}: ${starter.setupNote}`);
    }
  }

  return { kind: "ok", starterConfig };
}
