import * as p from "@clack/prompts";
import {
  getLlmOAuthProvider,
  llmOAuthStatusListSchema,
  llmProviderIds,
  llmProviderSchema,
  modelRefSchema,
  supportedLlmAuthKinds,
  type LlmAuthKind,
  type LlmProvider,
  type ModelRef,
  type SecretBinding,
  type SecretKey,
} from "@tetherbox/core";
import pc from "picocolors";
import { captureDaemonCommand, runDaemonCommand } from "./remote.ts";
import { ensureLlmProviderSecret, setLlmProviderSecret } from "./secrets.ts";

function describeAuthKind(provider: LlmProvider, kind: LlmAuthKind): string {
  switch (kind) {
    case "api-key":
      return "API key";
    case "oauth":
      return `OAuth login (${getLlmOAuthProvider(provider)?.label ?? provider})`;
    default: {
      const exhaustive: never = kind;

      return exhaustive;
    }
  }
}

export async function promptLlmProvider(): Promise<LlmProvider | undefined> {
  const rawProvider = await p.text({
    message: "Model provider",
    placeholder: "openai-codex",
    validate: (value) =>
      llmProviderSchema.safeParse(value?.trim()).success
        ? undefined
        : `Unsupported provider. Supported: ${llmProviderIds.join(", ")}`,
  });

  return p.isCancel(rawProvider) ? undefined : llmProviderSchema.parse(rawProvider.trim());
}

export async function promptLlmAuthKind(provider: LlmProvider): Promise<LlmAuthKind | undefined> {
  const kinds = supportedLlmAuthKinds(provider);
  const [only] = kinds;

  if (kinds.length === 1 && only !== undefined) {
    return only;
  }

  const kind = await p.select({
    message: `How should ${provider} authenticate?`,
    options: kinds.map((value) => ({ value, label: describeAuthKind(provider, value) })),
  });

  return p.isCancel(kind) ? undefined : kind;
}

export async function promptModelRef(): Promise<ModelRef | undefined> {
  const provider = await promptLlmProvider();

  if (provider === undefined) {
    return undefined;
  }

  const auth = await promptLlmAuthKind(provider);

  if (auth === undefined) {
    return undefined;
  }

  const modelId = await p.text({
    message: "Model ID",
    placeholder: "gpt-5.5",
    validate: (value) => (value?.trim() ? undefined : "A model ID is required"),
  });

  if (p.isCancel(modelId)) {
    return undefined;
  }

  return modelRefSchema.parse({ provider, id: modelId.trim(), auth });
}

export function modelRefArgs(model: ModelRef): string[] {
  return [`--provider=${model.provider}`, `--model=${model.id}`, `--auth=${model.auth}`];
}

export async function listOAuthLogins(sshAlias: string): Promise<Map<LlmProvider, string>> {
  const result = await captureDaemonCommand(sshAlias, ["llm", "status", "--json"]);

  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "failed to list OAuth logins on the VM");
  }

  const entries = llmOAuthStatusListSchema.parse(JSON.parse(result.stdout));

  return new Map(entries.map((entry) => [entry.provider, entry.expires]));
}

/**
 * Runs the daemon's OAuth login over an interactive SSH session. A fixed callback port is
 * forwarded so the browser redirect on this machine reaches the login flow on the VM.
 */
function runOAuthLogin(sshAlias: string, provider: LlmProvider): Promise<number> {
  const callbackPort = getLlmOAuthProvider(provider)?.callbackPort;

  return runDaemonCommand(sshAlias, ["llm", "login", provider], {
    interactive: true,
    forwardPorts: callbackPort === undefined ? [] : [callbackPort],
  });
}

async function oauthLogin(sshAlias: string, provider: LlmProvider): Promise<"ok" | "failed"> {
  const code = await runOAuthLogin(sshAlias, provider);

  if (code !== 0) {
    p.log.warn(
      `Login exited with code ${code}. Retry with: ${pc.cyan(`tetherbox llm login ${provider} --oauth`)}`,
    );

    return "failed";
  }

  return "ok";
}

export interface LlmLoginOptions {
  sshAlias: string;
  provider: LlmProvider;
  kind: LlmAuthKind;
  existingSecrets: Map<SecretKey, SecretBinding>;
}

export async function loginLlm({
  sshAlias,
  provider,
  kind,
  existingSecrets,
}: LlmLoginOptions): Promise<"ok" | "failed" | "cancelled"> {
  switch (kind) {
    case "api-key":
      return setLlmProviderSecret({ sshAlias, provider, existing: existingSecrets });
    case "oauth":
      return oauthLogin(sshAlias, provider);
    default: {
      const exhaustive: never = kind;

      return exhaustive;
    }
  }
}

export interface EnsureModelAuthOptions {
  sshAlias: string;
  model: ModelRef;
  existingSecrets: Map<SecretKey, SecretBinding>;
}

export async function ensureModelAuth({
  sshAlias,
  model,
  existingSecrets,
}: EnsureModelAuthOptions): Promise<"ok" | "cancelled"> {
  const { provider } = model;

  switch (model.auth) {
    case "api-key":
      return ensureLlmProviderSecret({ sshAlias, provider, existing: existingSecrets });
    case "oauth": {
      if ((await listOAuthLogins(sshAlias)).has(provider)) {
        p.log.success(`The daemon already has a ${provider} OAuth login.`);

        return "ok";
      }

      const shouldLogin = await p.confirm({
        message: `No ${provider} OAuth login on the VM. Log in now?`,
        initialValue: true,
      });

      if (p.isCancel(shouldLogin)) {
        return "cancelled";
      }

      if (!shouldLogin) {
        p.log.info(`Skipped. Log in later with: ${pc.cyan(`tetherbox llm login ${provider}`)}`);

        return "ok";
      }

      await oauthLogin(sshAlias, provider);

      return "ok";
    }
    default: {
      const exhaustive: never = model.auth;

      return exhaustive;
    }
  }
}
