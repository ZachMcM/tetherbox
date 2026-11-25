import * as p from "@clack/prompts";
import {
  getLlmOAuthProvider,
  llmOAuthProviders,
  llmProviderSchema,
  supportedLlmAuthKinds,
  type LlmAuthKind,
  type LlmProvider,
} from "@tetherbox/core";
import { Option, type Command } from "commander";
import pc from "picocolors";
import { readConfig } from "../config.ts";
import { listOAuthLogins, loginLlm, promptLlmAuthKind, promptLlmProvider } from "../llm.ts";
import { runDaemonCommand } from "../remote.ts";
import { findLlmProviderKey, listRemoteSecrets } from "../secrets.ts";

interface AuthKindFlags {
  apiKey?: boolean;
  oauth?: boolean;
}

function oauthProviderIds(): string {
  return llmOAuthProviders.map((entry) => entry.provider).join(", ");
}

function kindFromFlags(flags: AuthKindFlags): LlmAuthKind | undefined {
  if (flags.apiKey) {
    return "api-key";
  }

  return flags.oauth ? "oauth" : undefined;
}

function authKindOptions(apiKeyHelp: string, oauthHelp: string): Option[] {
  return [
    new Option("--api-key", apiKeyHelp).conflicts("oauth"),
    new Option("--oauth", oauthHelp).conflicts("apiKey"),
  ];
}

async function chooseLoginKind(
  provider: LlmProvider,
  flags: AuthKindFlags,
): Promise<LlmAuthKind | undefined> {
  const requested = kindFromFlags(flags);

  if (requested === undefined) {
    return promptLlmAuthKind(provider);
  }

  if (!supportedLlmAuthKinds(provider).includes(requested)) {
    throw new Error(
      requested === "oauth"
        ? `${provider} has no OAuth login. OAuth providers: ${oauthProviderIds()}`
        : `${provider} only signs in with OAuth`,
    );
  }

  return requested;
}

export function registerLlm(program: Command): void {
  const llm = program
    .command("llm")
    .description("Manage the LLM API keys and OAuth logins the daemon holds");

  const login = llm
    .command("login")
    .description("Store an API key or run an OAuth login for an LLM provider")
    .argument("[provider]", "provider slug, such as openai or openai-codex");

  for (const option of authKindOptions(
    "store an API key",
    `run an OAuth login (${oauthProviderIds()})`,
  )) {
    login.addOption(option);
  }

  login.action(async (rawProvider: string | undefined, flags: AuthKindFlags) => {
    const { sshAlias } = await readConfig();
    const provider =
      rawProvider === undefined ? await promptLlmProvider() : llmProviderSchema.parse(rawProvider);

    if (provider === undefined) {
      p.cancel("Login cancelled.");

      return;
    }

    const kind = await chooseLoginKind(provider, flags);

    if (kind === undefined) {
      p.cancel("Login cancelled.");

      return;
    }

    const status = await loginLlm({
      sshAlias,
      provider,
      kind,
      existingSecrets: await listRemoteSecrets(sshAlias),
    });

    process.exitCode = status === "ok" ? 0 : 1;
  });

  const logout = llm
    .command("logout")
    .description("Delete a provider's API key, OAuth login, or both")
    .argument("<provider>", "provider slug");

  for (const option of authKindOptions("delete only the API key", "delete only the OAuth login")) {
    logout.addOption(option);
  }

  logout.action(async (rawProvider: string, flags: AuthKindFlags) => {
    const { sshAlias } = await readConfig();
    const provider = llmProviderSchema.parse(rawProvider);
    const requested = kindFromFlags(flags);

    const removed: string[] = [];

    if (requested !== "api-key" && (await listOAuthLogins(sshAlias)).has(provider)) {
      if ((await runDaemonCommand(sshAlias, ["llm", "logout", provider])) !== 0) {
        throw new Error(`failed to delete the ${provider} OAuth login`);
      }

      removed.push("OAuth login");
    }

    const key =
      requested === "oauth"
        ? undefined
        : findLlmProviderKey(await listRemoteSecrets(sshAlias), provider);

    if (key !== undefined) {
      if ((await runDaemonCommand(sshAlias, ["secrets", "delete", key])) !== 0) {
        throw new Error(`failed to delete ${key}`);
      }

      removed.push(`API key ${key}`);
    }

    console.log(
      removed.length === 0
        ? `Nothing stored for ${provider}.`
        : `Removed ${removed.join(" and ")} for ${provider}.`,
    );
  });

  llm
    .command("status")
    .description("List providers with an API key or OAuth login")
    .action(async () => {
      const { sshAlias } = await readConfig();
      const logins = await listOAuthLogins(sshAlias);
      const secrets = await listRemoteSecrets(sshAlias);
      const rows: string[] = [];

      for (const [key, binding] of secrets) {
        if (binding.kind === "llm") {
          rows.push(`${pc.bold(binding.provider)}\tAPI key\t${key}`);
        }
      }

      for (const [provider, expires] of logins) {
        const label = getLlmOAuthProvider(provider)?.label ?? "unsupported provider";

        rows.push(`${pc.bold(provider)}\tOAuth\t${label}, access token expires ${expires}`);
      }

      console.log(rows.length === 0 ? "No LLM credentials stored." : rows.toSorted().join("\n"));
    });
}
