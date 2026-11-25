import * as p from "@clack/prompts";
import {
  formatSecretInjection,
  parseSecretInjection,
  secretBindingSchema,
  secretKeySchema,
  type LlmProvider,
  type SecretBinding,
  type SecretKey,
} from "@tetherbox/core";
import type { StarterSecret } from "@tetherbox/starters";
import { captureDaemonCommand, runDaemonCommand } from "./remote.ts";

export function toDaemonBindingArgs(binding: SecretBinding): string[] {
  switch (binding.kind) {
    case "daemon":
      return [];
    case "llm":
      return ["--provider", binding.provider];
    case "proxy":
      return [
        ...binding.domains.flatMap((domain) => ["--domain", domain]),
        "--inject",
        formatSecretInjection(binding.inject),
      ];
    default: {
      const exhaustive: never = binding;

      return exhaustive;
    }
  }
}

export function describeBinding(binding: SecretBinding): string {
  switch (binding.kind) {
    case "daemon":
      return "daemon-only";
    case "llm":
      return `LLM provider ${binding.provider}`;
    case "proxy":
      return `proxy for ${binding.domains.join(", ")} (${formatSecretInjection(binding.inject)})`;
    default: {
      const exhaustive: never = binding;

      return exhaustive;
    }
  }
}

function parseBindingColumns(columns: readonly string[]): SecretBinding {
  const [kind, target, injectSpec] = columns;

  switch (kind) {
    case "daemon":
      return { kind: "daemon" };
    case "llm":
      return secretBindingSchema.parse({ kind: "llm", provider: target });
    case "proxy":
      return secretBindingSchema.parse({
        kind: "proxy",
        domains: target === undefined || target === "" ? [] : target.split(","),
        inject: parseSecretInjection(injectSpec ?? "bearer"),
      });
    default:
      throw new Error(`unexpected secret binding kind "${kind ?? ""}"`);
  }
}

export function parseRemoteSecrets(stdout: string): Map<SecretKey, SecretBinding> {
  const result = new Map<SecretKey, SecretBinding>();

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();

    if (line === "") {
      continue;
    }

    const [rawKey, ...columns] = line.split("\t");
    const key = secretKeySchema.parse(rawKey);

    result.set(key, parseBindingColumns(columns));
  }

  return result;
}

export async function listRemoteSecrets(sshAlias: string): Promise<Map<SecretKey, SecretBinding>> {
  const result = await captureDaemonCommand(sshAlias, ["secrets", "list"]);

  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "failed to list secrets on the VM");
  }

  return parseRemoteSecrets(result.stdout);
}

function sameInjection(a: SecretBinding, b: SecretBinding): boolean {
  if (a.kind !== "proxy" || b.kind !== "proxy") {
    return false;
  }

  return formatSecretInjection(a.inject) === formatSecretInjection(b.inject);
}

export function bindingSatisfies(existing: SecretBinding, required: SecretBinding): boolean {
  if (existing.kind !== required.kind) {
    return false;
  }

  switch (required.kind) {
    case "daemon":
      return true;
    case "llm":
      return existing.kind === "llm" && existing.provider === required.provider;
    case "proxy":
      return (
        existing.kind === "proxy" &&
        sameInjection(existing, required) &&
        required.domains.every((domain) => existing.domains.includes(domain))
      );
    default: {
      const exhaustive: never = required;

      return exhaustive;
    }
  }
}

function mergeRequiredBinding(
  existing: SecretBinding | undefined,
  required: SecretBinding,
): SecretBinding {
  if (
    existing?.kind === "proxy" &&
    required.kind === "proxy" &&
    sameInjection(existing, required)
  ) {
    const mergedDomains = [...new Set([...existing.domains, ...required.domains])];

    return secretBindingSchema.parse({
      kind: "proxy",
      domains: mergedDomains,
      inject: required.inject,
    });
  }

  return required;
}

export interface PromptAndSetSecretOptions {
  sshAlias: string;
  key: SecretKey;
  binding: SecretBinding;
  message?: string;
}

export async function promptAndSetSecret({
  sshAlias,
  key,
  binding,
  message,
}: PromptAndSetSecretOptions): Promise<"set" | "cancelled"> {
  const value = await p.password({ message: message ?? `Value for ${key}` });

  if (p.isCancel(value) || value === "") {
    return "cancelled";
  }

  const code = await runDaemonCommand(
    sshAlias,
    ["secrets", "set", key, ...toDaemonBindingArgs(binding)],
    { input: value },
  );

  if (code !== 0) {
    throw new Error(`failed to store secret ${key}`);
  }

  return "set";
}

export interface EnsureRequiredSecretsOptions {
  sshAlias: string;
  required: readonly StarterSecret[];
  existing?: Map<SecretKey, SecretBinding>;
}

export async function ensureRequiredSecrets({
  sshAlias,
  required,
  existing,
}: EnsureRequiredSecretsOptions): Promise<"ok" | "cancelled"> {
  if (required.length === 0) {
    return "ok";
  }

  const secrets = existing ?? (await listRemoteSecrets(sshAlias));

  for (const entry of required) {
    const current = secrets.get(entry.key);

    if (current !== undefined && bindingSatisfies(current, entry.binding)) {
      continue;
    }

    const nextBinding = mergeRequiredBinding(current, entry.binding);

    if (current === undefined) {
      p.log.info(`Missing secret ${entry.key} (${describeBinding(nextBinding)}).`);
    } else {
      p.log.info(
        `Secret ${entry.key} is currently ${describeBinding(current)}, updating to ${describeBinding(nextBinding)}.`,
      );
    }

    const status = await promptAndSetSecret({
      sshAlias,
      key: entry.key,
      binding: nextBinding,
      message: `Enter ${entry.key}`,
    });

    if (status === "cancelled") {
      return "cancelled";
    }

    secrets.set(entry.key, nextBinding);
  }

  return "ok";
}

export interface EnsureLlmProviderSecretOptions {
  sshAlias: string;
  provider: LlmProvider;
  existing?: Map<SecretKey, SecretBinding>;
}

export async function ensureLlmProviderSecret({
  sshAlias,
  provider,
  existing,
}: EnsureLlmProviderSecretOptions): Promise<"ok" | "cancelled"> {
  const secrets = existing ?? (await listRemoteSecrets(sshAlias));

  for (const binding of secrets.values()) {
    if (binding.kind === "llm" && binding.provider === provider) {
      return "ok";
    }
  }

  const key = secretKeySchema.parse(`${provider.toUpperCase().replaceAll("-", "_")}_API_KEY`);
  const binding: SecretBinding = { kind: "llm", provider };

  p.log.info(`No LLM credential is stored for provider "${provider}".`);

  const status = await promptAndSetSecret({
    sshAlias,
    key,
    binding,
    message: `Enter ${key} for ${provider}`,
  });

  if (status === "cancelled") {
    return "cancelled";
  }

  secrets.set(key, binding);

  return "ok";
}
