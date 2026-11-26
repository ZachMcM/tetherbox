import * as p from "@clack/prompts";
import {
  customOAuthLoginSchema,
  DEFAULT_OAUTH_CALLBACK_PATH,
  DEFAULT_OAUTH_CALLBACK_PORT,
  getOAuthPreset,
  oauthPresetIds,
  oauthScopeModeSchema,
  secretKeySchema,
  type OAuthPreset,
} from "@tetherbox/core";
import type { Command } from "commander";
import pc from "picocolors";
import { readConfig } from "../config.ts";
import {
  listRemoteOAuth,
  promptOAuthPreset,
  runCustomOAuthLogin,
  runOAuthPresetLogin,
} from "../oauth.ts";
import { runDaemonCommand } from "../remote.ts";
import { listRemoteSecrets } from "../secrets.ts";

function supportedPresetIds(): string {
  return oauthPresetIds.join(", ");
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function resolvePresetOrExit(rawPreset: string): OAuthPreset | undefined {
  const preset = getOAuthPreset(rawPreset);

  if (preset === undefined) {
    console.error(
      `Unknown OAuth preset "${rawPreset}". Supported presets: ${supportedPresetIds()}.`,
    );
    process.exitCode = 1;

    return undefined;
  }

  return preset;
}

interface CustomOAuthCommandOptions {
  authUrl: string;
  tokenUrl: string;
  domain: string[];
  scope: string[];
  clientIdKey?: string;
  clientSecretKey?: string;
  callbackPort?: string;
  callbackPath?: string;
  authParam: string[];
}

export function registerOAuth(program: Command): void {
  const oauth = program
    .command("oauth")
    .description("Manage OAuth2 integration logins held by the daemon");

  oauth
    .command("login")
    .description("Authenticate a built-in OAuth2 integration and store its token on the VM")
    .argument("[preset]", `OAuth preset (${supportedPresetIds()})`)
    .option("--scope <mode>", "permission level: read-only or read-write")
    .action(async (rawPreset: string | undefined, options: { scope?: string }) => {
      const { sshAlias } = await readConfig();
      const preset =
        rawPreset === undefined ? await promptOAuthPreset() : resolvePresetOrExit(rawPreset);

      if (preset === undefined) {
        if (rawPreset === undefined) {
          p.cancel("OAuth login cancelled.");
        }

        return;
      }

      const scopeMode =
        options.scope === undefined ? undefined : oauthScopeModeSchema.parse(options.scope);
      const existingSecrets = await listRemoteSecrets(sshAlias);
      const status = await runOAuthPresetLogin({
        sshAlias,
        preset,
        ...(scopeMode !== undefined ? { scopeMode } : {}),
        existingSecrets,
      });

      if (status === "cancelled") {
        p.cancel("OAuth login cancelled.");

        return;
      }

      process.exitCode = status === "ok" ? 0 : 1;
    });

  oauth
    .command("custom")
    .description("Authenticate a custom OAuth2 provider for a module secret key")
    .argument("<secret-key>", "secret key name (for example SPOTIFY_OAUTH)")
    .requiredOption("--auth-url <url>", "OAuth2 authorization endpoint (https://...)")
    .requiredOption("--token-url <url>", "OAuth2 token endpoint (https://...)")
    .option("--domain <host>", "pinned API hostname (repeatable)", collectOption, [])
    .option("--scope <scope>", "OAuth2 scope (repeatable)", collectOption, [])
    .option("--client-id-key <key>", "daemon secret key holding the OAuth client ID")
    .option("--client-secret-key <key>", "daemon secret key holding the OAuth client secret")
    .option(
      "--callback-port <port>",
      `loopback callback port (default ${String(DEFAULT_OAUTH_CALLBACK_PORT)})`,
    )
    .option(
      "--callback-path <path>",
      `loopback callback path (default ${DEFAULT_OAUTH_CALLBACK_PATH})`,
    )
    .option(
      "--auth-param <key=value>",
      "extra query param for the auth URL (repeatable)",
      collectOption,
      [],
    )
    .action(async (rawKey: string, options: CustomOAuthCommandOptions) => {
      const secretKey = secretKeySchema.parse(rawKey);
      const extraAuthParams: Record<string, string> = {};

      for (const rawParam of options.authParam) {
        const sep = rawParam.indexOf("=");

        if (sep <= 0) {
          throw new Error(`invalid --auth-param "${rawParam}", expected key=value`);
        }

        extraAuthParams[rawParam.slice(0, sep)] = rawParam.slice(sep + 1);
      }

      const clientIdKey =
        options.clientIdKey !== undefined
          ? secretKeySchema.parse(options.clientIdKey)
          : secretKeySchema.parse(`${secretKey}_CLIENT_ID`);
      const validated = customOAuthLoginSchema.parse({
        secretKey,
        authorizationUrl: options.authUrl,
        tokenUrl: options.tokenUrl,
        domains: options.domain,
        scopes: options.scope,
        clientIdSecretKey: clientIdKey,
        ...(options.clientSecretKey !== undefined
          ? { clientSecretSecretKey: secretKeySchema.parse(options.clientSecretKey) }
          : {}),
        ...(options.callbackPort !== undefined
          ? { callbackPort: Number(options.callbackPort) }
          : {}),
        ...(options.callbackPath !== undefined ? { callbackPath: options.callbackPath } : {}),
        ...(Object.keys(extraAuthParams).length > 0 ? { extraAuthParams } : {}),
      });

      const { sshAlias } = await readConfig();
      const existingSecrets = await listRemoteSecrets(sshAlias);
      const status = await runCustomOAuthLogin({
        sshAlias,
        secretKey: validated.secretKey,
        authorizationUrl: validated.authorizationUrl,
        tokenUrl: validated.tokenUrl,
        domains: validated.domains,
        scopes: validated.scopes,
        clientIdSecretKey: validated.clientIdSecretKey,
        ...(validated.clientSecretSecretKey !== undefined
          ? { clientSecretSecretKey: validated.clientSecretSecretKey }
          : {}),
        callbackPort: validated.callbackPort,
        callbackPath: validated.callbackPath,
        authParams: options.authParam,
        existingSecrets,
      });

      if (status === "cancelled") {
        p.cancel("OAuth login cancelled.");

        return;
      }

      process.exitCode = status === "ok" ? 0 : 1;
    });

  oauth
    .command("logout")
    .description("Delete a stored OAuth2 integration token from the VM")
    .argument("<target>", `OAuth preset (${supportedPresetIds()}) or custom SECRET_KEY`)
    .action(async (rawTarget: string) => {
      const preset = getOAuthPreset(rawTarget);
      const target = preset !== undefined ? preset.id : secretKeySchema.parse(rawTarget);
      const { sshAlias } = await readConfig();
      const code = await runDaemonCommand(sshAlias, ["oauth", "logout", target]);

      if (code !== 0) {
        process.exitCode = code;

        return;
      }

      console.log(
        preset !== undefined
          ? `Removed ${preset.label} OAuth token (${preset.secretKey}).`
          : `Removed custom OAuth token (${target}).`,
      );
    });

  oauth
    .command("status")
    .description("List stored OAuth2 integration tokens on the VM")
    .action(async () => {
      const { sshAlias } = await readConfig();
      const logins = await listRemoteOAuth(sshAlias);

      if (logins.length === 0) {
        console.log("No OAuth2 integration logins stored.");

        return;
      }

      const rows = logins
        .toSorted((a, b) => a.secretKey.localeCompare(b.secretKey))
        .map((entry) =>
          entry.kind === "preset"
            ? `${pc.bold(entry.preset)}\t${entry.secretKey}\t${entry.scopeMode}\taccess token expires ${entry.expires}`
            : `${pc.bold("custom")}\t${entry.secretKey}\t${entry.domains.join(",")}\taccess token expires ${entry.expires}`,
        );

      console.log(rows.join("\n"));
    });
}
