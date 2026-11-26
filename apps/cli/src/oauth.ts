import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import * as p from "@clack/prompts";
import {
  DEFAULT_OAUTH_CALLBACK_PATH,
  DEFAULT_OAUTH_CALLBACK_PORT,
  getOAuthPreset,
  getOAuthProvider,
  oauthPresets,
  oauthStatusListSchema,
  secretKeySchema,
  type OAuthPreset,
  type OAuthPresetId,
  type OAuthProviderConfig,
  type OAuthScopeMode,
  type OAuthStatusEntry,
  type SecretBinding,
  type SecretKey,
} from "@tetherbox/core";
import pc from "picocolors";
import { z } from "zod";
import { captureDaemonCommand, runDaemonCommand } from "./remote.ts";

const googleClientJsonSchema = z.object({
  installed: z
    .object({
      client_id: z.string().min(1),
      client_secret: z.string().min(1),
    })
    .optional(),
  web: z
    .object({
      client_id: z.string().min(1),
      client_secret: z.string().min(1),
    })
    .optional(),
});

function expandHome(rawPath: string): string {
  const trimmed = rawPath.trim();

  if (trimmed === "~") {
    return homedir();
  }

  if (trimmed.startsWith("~/")) {
    return resolve(homedir(), trimmed.slice(2));
  }

  return resolve(trimmed);
}

async function storeDaemonSecret(
  sshAlias: string,
  key: SecretKey,
  value: string,
  existingSecrets: Map<SecretKey, SecretBinding>,
): Promise<void> {
  const code = await runDaemonCommand(sshAlias, ["secrets", "set", key], { input: value });

  if (code !== 0) {
    throw new Error(`failed to store secret ${key}`);
  }

  existingSecrets.set(key, { kind: "daemon" });
}

async function readGoogleClientFile(
  rawPath: string,
): Promise<{ clientId: string; clientSecret: string; isWeb: boolean }> {
  const content = await readFile(expandHome(rawPath), "utf8");
  const parsed = googleClientJsonSchema.parse(JSON.parse(content));

  if (parsed.installed !== undefined) {
    return {
      clientId: parsed.installed.client_id,
      clientSecret: parsed.installed.client_secret,
      isWeb: false,
    };
  }

  if (parsed.web !== undefined) {
    return {
      clientId: parsed.web.client_id,
      clientSecret: parsed.web.client_secret,
      isWeb: true,
    };
  }

  throw new Error('JSON file does not contain an "installed" Desktop OAuth client section');
}

export async function listRemoteOAuth(sshAlias: string): Promise<OAuthStatusEntry[]> {
  const result = await captureDaemonCommand(sshAlias, ["oauth", "status", "--json"]);

  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "failed to list OAuth logins on the VM");
  }

  return oauthStatusListSchema.parse(JSON.parse(result.stdout));
}

export async function promptOAuthPreset(): Promise<OAuthPreset | undefined> {
  const selected = await p.select<OAuthPreset>({
    message: "Select an OAuth integration",
    options: oauthPresets.map((preset) => ({
      value: preset,
      label: preset.id,
      hint: `${preset.label} (${preset.secretKey})`,
    })),
  });

  return p.isCancel(selected) ? undefined : selected;
}

export async function promptOAuthScopeMode(
  preset: OAuthPreset,
): Promise<OAuthScopeMode | undefined> {
  const modes: readonly OAuthScopeMode[] =
    preset.defaultScopeMode === "read-only"
      ? ["read-only", "read-write"]
      : ["read-write", "read-only"];

  const selected = await p.select({
    message: `Permission level for ${preset.label}`,
    options: modes.map((mode) => ({
      value: mode,
      label: mode === "read-only" ? "Read-only" : "Read and write",
      hint: preset.scopes[mode].join(", "),
    })),
  });

  return p.isCancel(selected) ? undefined : selected;
}

export interface EnsureOAuthClientOptions {
  readonly sshAlias: string;
  readonly provider: OAuthProviderConfig;
  readonly existingSecrets: Map<SecretKey, SecretBinding>;
}

export async function ensureOAuthClientCredentials({
  sshAlias,
  provider,
  existingSecrets,
}: EnsureOAuthClientOptions): Promise<"ok" | "cancelled"> {
  if (
    existingSecrets.has(provider.clientIdSecretKey) &&
    existingSecrets.has(provider.clientSecretSecretKey)
  ) {
    return "ok";
  }

  p.log.info(
    `${provider.label} OAuth client credentials are not stored on the VM yet (${provider.clientIdSecretKey} and ${provider.clientSecretSecretKey}).`,
  );
  p.log.info(
    `Create a Desktop OAuth 2.0 Client ID in Google Cloud Console (APIs & Services -> Credentials).`,
  );

  const method = await p.select({
    message: `How do you want to provide ${provider.label} OAuth client credentials?`,
    options: [
      {
        value: "file" as const,
        label: "Import downloaded client_secret_*.json file",
        hint: "from Google Cloud Console",
      },
      {
        value: "manual" as const,
        label: "Enter Client ID and Client Secret manually",
      },
    ],
  });

  if (p.isCancel(method)) {
    return "cancelled";
  }

  let clientId: string;
  let clientSecret: string;

  if (method === "file") {
    const filePath = await p.text({
      message: "Path to Google Desktop OAuth client_secret.json",
      placeholder: "~/Downloads/client_secret_....json",
      validate: (value) => (value?.trim() ? undefined : "A file path is required"),
    });

    if (p.isCancel(filePath)) {
      return "cancelled";
    }

    const loaded = await readGoogleClientFile(filePath);

    if (loaded.isWeb) {
      p.log.warn(
        `This file looks like a Web OAuth client. Loopback login works best with a Desktop client (or add http://127.0.0.1:${provider.callbackPort}${provider.callbackPath} as an authorized redirect URI).`,
      );
    }

    clientId = loaded.clientId;
    clientSecret = loaded.clientSecret;
  } else {
    const enteredId = await p.text({
      message: `${provider.label} OAuth Client ID`,
      validate: (value) => (value?.trim() ? undefined : "Client ID is required"),
    });

    if (p.isCancel(enteredId)) {
      return "cancelled";
    }

    const enteredSecret = await p.password({
      message: `${provider.label} OAuth Client Secret`,
      validate: (value) => (value?.trim() ? undefined : "Client Secret is required"),
    });

    if (p.isCancel(enteredSecret)) {
      return "cancelled";
    }

    clientId = enteredId.trim();
    clientSecret = enteredSecret.trim();
  }

  await storeDaemonSecret(sshAlias, provider.clientIdSecretKey, clientId, existingSecrets);
  await storeDaemonSecret(sshAlias, provider.clientSecretSecretKey, clientSecret, existingSecrets);
  p.log.success(`Stored ${provider.label} OAuth client credentials on the VM.`);

  return "ok";
}

export interface RunOAuthPresetLoginOptions {
  readonly sshAlias: string;
  readonly preset: OAuthPreset;
  readonly scopeMode?: OAuthScopeMode;
  readonly existingSecrets: Map<SecretKey, SecretBinding>;
}

export async function runOAuthPresetLogin({
  sshAlias,
  preset,
  scopeMode: requestedScopeMode,
  existingSecrets,
}: RunOAuthPresetLoginOptions): Promise<"ok" | "failed" | "cancelled"> {
  const provider = getOAuthProvider(preset.provider);
  const clientStatus = await ensureOAuthClientCredentials({
    sshAlias,
    provider,
    existingSecrets,
  });

  if (clientStatus === "cancelled") {
    return "cancelled";
  }

  const scopeMode = requestedScopeMode ?? (await promptOAuthScopeMode(preset));

  if (scopeMode === undefined) {
    return "cancelled";
  }

  const code = await runDaemonCommand(
    sshAlias,
    ["oauth", "login", preset.id, `--scope=${scopeMode}`],
    {
      interactive: true,
      forwardPorts: [provider.callbackPort],
    },
  );

  if (code !== 0) {
    p.log.warn(
      `${preset.label} OAuth login exited with code ${code}. Retry with: ${pc.cyan(`tetherbox oauth login ${preset.id}`)}`,
    );

    return "failed";
  }

  return "ok";
}

export interface RunCustomOAuthLoginOptions {
  readonly sshAlias: string;
  readonly secretKey: SecretKey;
  readonly authorizationUrl: string;
  readonly tokenUrl: string;
  readonly domains: readonly string[];
  readonly scopes: readonly string[];
  readonly clientIdSecretKey?: SecretKey;
  readonly clientSecretSecretKey?: SecretKey;
  readonly callbackPort?: number;
  readonly callbackPath?: string;
  readonly authParams?: readonly string[];
  readonly existingSecrets: Map<SecretKey, SecretBinding>;
}

export async function runCustomOAuthLogin({
  sshAlias,
  secretKey,
  authorizationUrl,
  tokenUrl,
  domains,
  scopes,
  clientIdSecretKey: explicitClientIdKey,
  clientSecretSecretKey: explicitClientSecretKey,
  callbackPort = DEFAULT_OAUTH_CALLBACK_PORT,
  callbackPath = DEFAULT_OAUTH_CALLBACK_PATH,
  authParams = [],
  existingSecrets,
}: RunCustomOAuthLoginOptions): Promise<"ok" | "failed" | "cancelled"> {
  const clientIdKey = explicitClientIdKey ?? secretKeySchema.parse(`${secretKey}_CLIENT_ID`);
  const defaultSecretKey = secretKeySchema.parse(`${secretKey}_CLIENT_SECRET`);
  let clientSecretKey = explicitClientSecretKey;

  if (!existingSecrets.has(clientIdKey)) {
    const enteredId = await p.text({
      message: `OAuth Client ID (will be stored as ${clientIdKey})`,
      validate: (value) => (value?.trim() ? undefined : "Client ID is required"),
    });

    if (p.isCancel(enteredId)) {
      return "cancelled";
    }

    await storeDaemonSecret(sshAlias, clientIdKey, enteredId.trim(), existingSecrets);
  }

  const candidateSecretKey = clientSecretKey ?? defaultSecretKey;

  if (existingSecrets.has(candidateSecretKey)) {
    clientSecretKey = candidateSecretKey;
  } else {
    const enteredSecret = await p.password({
      message: `OAuth Client Secret (leave blank for a public PKCE client; stored as ${candidateSecretKey})`,
    });

    if (p.isCancel(enteredSecret)) {
      return "cancelled";
    }

    if (enteredSecret.trim() !== "") {
      await storeDaemonSecret(sshAlias, candidateSecretKey, enteredSecret.trim(), existingSecrets);
      clientSecretKey = candidateSecretKey;
    } else {
      clientSecretKey = undefined;
    }
  }

  const args = [
    "oauth",
    "custom",
    secretKey,
    `--auth-url=${authorizationUrl}`,
    `--token-url=${tokenUrl}`,
    ...domains.map((domain) => `--domain=${domain}`),
    ...scopes.map((scope) => `--scope=${scope}`),
    `--client-id-key=${clientIdKey}`,
    ...(clientSecretKey !== undefined ? [`--client-secret-key=${clientSecretKey}`] : []),
    `--callback-port=${String(callbackPort)}`,
    `--callback-path=${callbackPath}`,
    ...authParams.map((param) => `--auth-param=${param}`),
  ];

  const code = await runDaemonCommand(sshAlias, args, {
    interactive: true,
    forwardPorts: [callbackPort],
  });

  if (code !== 0) {
    p.log.warn(`Custom OAuth login for ${secretKey} exited with code ${code}.`);

    return "failed";
  }

  return "ok";
}

export interface EnsureStarterOAuthOptions {
  readonly sshAlias: string;
  readonly presetIds: readonly OAuthPresetId[];
  readonly existingSecrets: Map<SecretKey, SecretBinding>;
}

export async function ensureStarterOAuth({
  sshAlias,
  presetIds,
  existingSecrets,
}: EnsureStarterOAuthOptions): Promise<"ok" | "cancelled"> {
  if (presetIds.length === 0) {
    return "ok";
  }

  const existingByPreset = new Map(
    (await listRemoteOAuth(sshAlias))
      .filter((entry) => entry.kind === "preset")
      .map((entry) => [entry.preset, entry]),
  );

  for (const presetId of presetIds) {
    const preset = getOAuthPreset(presetId);

    if (preset === undefined) {
      continue;
    }

    const current = existingByPreset.get(presetId);

    if (current !== undefined) {
      p.log.success(
        `${preset.label} OAuth is already connected (${current.scopeMode}, ${current.secretKey}).`,
      );
      continue;
    }

    const shouldLogin = await p.confirm({
      message: `${preset.label} is not connected via OAuth. Log in now?`,
      initialValue: true,
    });

    if (p.isCancel(shouldLogin)) {
      return "cancelled";
    }

    if (!shouldLogin) {
      p.log.info(`Skipped. Connect later with: ${pc.cyan(`tetherbox oauth login ${preset.id}`)}`);
      continue;
    }

    const status = await runOAuthPresetLogin({ sshAlias, preset, existingSecrets });

    if (status === "cancelled") {
      return "cancelled";
    }
  }

  return "ok";
}
