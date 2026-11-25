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

function toDaemonBindingArgs(binding: SecretBinding): string[] {
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

function describeBinding(binding: SecretBinding): string {
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

function parseRemoteSecrets(stdout: string): Map<SecretKey, SecretBinding> {
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

function bindingSatisfies(existing: SecretBinding, required: SecretBinding): boolean {
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
        formatSecretInjection(existing.inject) === formatSecretInjection(required.inject) &&
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
    formatSecretInjection(existing.inject) === formatSecretInjection(required.inject)
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
  existing: Map<SecretKey, SecretBinding>;
}

export async function ensureRequiredSecrets({
  sshAlias,
  required,
  existing,
}: EnsureRequiredSecretsOptions): Promise<"ok" | "cancelled"> {
  for (const entry of required) {
    const current = existing.get(entry.key);

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

    existing.set(entry.key, nextBinding);
  }

  return "ok";
}

export function findLlmProviderKey(
  existing: Map<SecretKey, SecretBinding>,
  provider: LlmProvider,
): SecretKey | undefined {
  for (const [key, binding] of existing) {
    if (binding.kind === "llm" && binding.provider === provider) {
      return key;
    }
  }

  return undefined;
}

export interface LlmProviderSecretOptions {
  sshAlias: string;
  provider: LlmProvider;
  existing: Map<SecretKey, SecretBinding>;
}

export async function setLlmProviderSecret({
  sshAlias,
  provider,
  existing,
}: LlmProviderSecretOptions): Promise<"ok" | "cancelled"> {
  const binding: SecretBinding = { kind: "llm", provider };
  const boundKey = findLlmProviderKey(existing, provider);
  const key =
    boundKey ?? secretKeySchema.parse(`${provider.toUpperCase().replaceAll("-", "_")}_API_KEY`);
  const current = existing.get(key);

  if (boundKey !== undefined) {
    p.log.info(`Replacing ${key}, the API key for ${provider}.`);
  } else if (current !== undefined) {
    p.log.warn(
      `Secret ${key} is currently ${describeBinding(current)}; continuing will overwrite it as ${describeBinding(binding)}.`,
    );
  }

  const status = await promptAndSetSecret({
    sshAlias,
    key,
    binding,
    message: `Enter ${key} for ${provider}`,
  });

  if (status === "cancelled") {
    return "cancelled";
  }

  existing.set(key, binding);

  return "ok";
}

export async function ensureLlmProviderSecret(
  options: LlmProviderSecretOptions,
): Promise<"ok" | "cancelled"> {
  if (findLlmProviderKey(options.existing, options.provider) !== undefined) {
    return "ok";
  }

  p.log.info(`No API key is stored for provider "${options.provider}".`);

  return setLlmProviderSecret(options);
}
