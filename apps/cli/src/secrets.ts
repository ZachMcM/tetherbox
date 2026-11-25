import * as p from "@clack/prompts";
import {
  formatSecretInjection,
  hostnameSchema,
  secretBindingSchema,
  secretKeySchema,
  secretListSchema,
  type LlmProvider,
  type SecretBinding,
  type SecretKey,
  type StarterConfig,
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

export async function listRemoteSecrets(sshAlias: string): Promise<Map<SecretKey, SecretBinding>> {
  const result = await captureDaemonCommand(sshAlias, ["secrets", "list", "--json"]);

  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "failed to list secrets on the VM");
  }

  const entries = secretListSchema.parse(JSON.parse(result.stdout));

  return new Map(entries.map((entry) => [entry.key, entry.binding]));
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
  starterConfig?: StarterConfig;
}

function domainFromConfigUrl(
  starterConfig: StarterConfig | undefined,
  ref: { readonly starterId: string; readonly key: string } | undefined,
): string | undefined {
  if (starterConfig === undefined || ref === undefined) {
    return undefined;
  }

  const rawUrl = starterConfig[ref.starterId]?.[ref.key];

  if (rawUrl === undefined) {
    return undefined;
  }

  const parsed = URL.parse(rawUrl);

  if (parsed === null) {
    return undefined;
  }

  const hostname = parsed.hostname.toLowerCase();

  return hostnameSchema.safeParse(hostname).success ? hostname : undefined;
}

async function resolveRequiredBinding(
  entry: StarterSecret,
  current: SecretBinding | undefined,
  starterConfig: StarterConfig | undefined,
): Promise<SecretBinding | "satisfied" | "cancelled"> {
  switch (entry.kind) {
    case "fixed": {
      if (current !== undefined && bindingSatisfies(current, entry.binding)) {
        return "satisfied";
      }

      return mergeRequiredBinding(current, entry.binding);
    }
    case "prompt-domain": {
      const derivedDomain = domainFromConfigUrl(starterConfig, entry.fromConfigUrl);

      if (derivedDomain !== undefined) {
        const requiredBinding = secretBindingSchema.parse({
          kind: "proxy",
          domains: [derivedDomain],
          inject: entry.inject,
        });

        if (current !== undefined && bindingSatisfies(current, requiredBinding)) {
          return "satisfied";
        }

        return mergeRequiredBinding(current, requiredBinding);
      }

      if (
        current?.kind === "proxy" &&
        formatSecretInjection(current.inject) === formatSecretInjection(entry.inject)
      ) {
        return "satisfied";
      }

      const rawDomain = await p.text({
        message: entry.domainPrompt,
        placeholder: entry.domainPlaceholder,
        validate: (value) =>
          hostnameSchema.safeParse(value?.trim().toLowerCase()).success
            ? undefined
            : "Enter a valid hostname without scheme or path",
      });

      if (p.isCancel(rawDomain)) {
        return "cancelled";
      }

      const binding = secretBindingSchema.parse({
        kind: "proxy",
        domains: [rawDomain.trim().toLowerCase()],
        inject: entry.inject,
      });

      return mergeRequiredBinding(current, binding);
    }
    default: {
      const exhaustive: never = entry;

      return exhaustive;
    }
  }
}

export async function ensureRequiredSecrets({
  sshAlias,
  required,
  existing,
  starterConfig,
}: EnsureRequiredSecretsOptions): Promise<"ok" | "cancelled"> {
  for (const entry of required) {
    const current = existing.get(entry.key);
    const resolved = await resolveRequiredBinding(entry, current, starterConfig);

    if (resolved === "satisfied") {
      continue;
    }

    if (resolved === "cancelled") {
      return "cancelled";
    }

    if (current === undefined) {
      p.log.info(`Missing secret ${entry.key} (${describeBinding(resolved)}).`);
    } else {
      p.log.info(
        `Secret ${entry.key} is currently ${describeBinding(current)}, updating to ${describeBinding(resolved)}.`,
      );
    }

    const status = await promptAndSetSecret({
      sshAlias,
      key: entry.key,
      binding: resolved,
      message: `Enter ${entry.key}`,
    });

    if (status === "cancelled") {
      return "cancelled";
    }

    existing.set(entry.key, resolved);
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
