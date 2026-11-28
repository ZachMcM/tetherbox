import { join } from "node:path";
import {
  customOAuthLoginSchema,
  getOAuthPreset,
  getOAuthProvider,
  hostnameSchema,
  oauthPresetSchema,
  oauthProviderSchema,
  oauthScopeModeSchema,
  RpcError,
  secretKeySchema,
  type CustomOAuthLoginInput,
  type OAuthPresetId,
  type OAuthProviderId,
  type OAuthScopeMode,
  type OAuthStatusEntry,
  type SecretKey,
} from "@tetherbox/core";
import { z } from "zod";
import { createKeyedJsonStore, createKeyedLock } from "../file-store.ts";
import {
  createWebOAuthFlowStore,
  postTokenForm,
  type OAuthFlowConfig,
  type OAuthTokenBundle,
  type WebOAuthCallbackInput,
} from "./oauth-flow.ts";
import type { SecretStore } from "./secret-store.ts";

const REFRESH_MARGIN_MS = 60_000;

const storedOAuthCredentialBase = {
  secretKey: secretKeySchema,
  scopes: z.tuple([z.string().min(1)], z.string().min(1)),
  domains: z.tuple([hostnameSchema], hostnameSchema),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number(),
};

const storedOAuthCredentialSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("preset"),
    preset: oauthPresetSchema,
    provider: oauthProviderSchema,
    scopeMode: oauthScopeModeSchema,
    ...storedOAuthCredentialBase,
  }),
  z.object({
    kind: z.literal("custom"),
    authorizationUrl: z.string().url(),
    tokenUrl: z.string().url(),
    clientIdSecretKey: secretKeySchema,
    clientSecretSecretKey: secretKeySchema.optional(),
    ...storedOAuthCredentialBase,
  }),
]);

type StoredOAuthCredential = z.infer<typeof storedOAuthCredentialSchema>;

export type OAuthLoginSummary =
  | {
      readonly kind: "preset";
      readonly preset: OAuthPresetId;
      readonly provider: OAuthProviderId;
      readonly secretKey: SecretKey;
      readonly scopeMode: OAuthScopeMode;
      readonly scopes: readonly [string, ...string[]];
      readonly domains: readonly [string, ...string[]];
      readonly expiresAt: number;
    }
  | {
      readonly kind: "custom";
      readonly secretKey: SecretKey;
      readonly tokenUrl: string;
      readonly scopes: readonly [string, ...string[]];
      readonly domains: readonly [string, ...string[]];
      readonly expiresAt: number;
    };

export interface OAuthAccess {
  readonly token: string;
  readonly domains: readonly [string, ...string[]];
}

export interface OAuthAccessOptions {
  readonly staleToken?: string;
}

export interface WebOAuthPresetOptions {
  readonly redirectUri: string;
  readonly scopeMode?: OAuthScopeMode | undefined;
}

export type { WebOAuthCallbackInput };

export interface OAuthStore {
  startWebPresetLogin(
    presetId: OAuthPresetId,
    options: WebOAuthPresetOptions,
  ): Promise<{ authorizationUrl: string }>;
  startWebCustomLogin(
    input: CustomOAuthLoginInput,
    redirectUri: string,
  ): Promise<{ authorizationUrl: string }>;
  completeWebLogin(callback: WebOAuthCallbackInput): Promise<OAuthLoginSummary>;
  logout(target: string): Promise<SecretKey>;
  list(): Promise<OAuthLoginSummary[]>;
  has(secretKey: SecretKey): Promise<boolean>;
  access(secretKey: SecretKey, options?: OAuthAccessOptions): Promise<OAuthAccess | undefined>;
}

interface PreparedOAuthFlow {
  readonly config: OAuthFlowConfig;
  readonly buildCredential: (tokens: OAuthTokenBundle) => StoredOAuthCredential;
}

export function formatExpiry(expires: number): string {
  const date = new Date(expires);

  return Number.isNaN(date.getTime()) ? "never" : date.toISOString();
}

export function toOAuthStatusEntry(entry: OAuthLoginSummary): OAuthStatusEntry {
  const scopes: [string, ...string[]] = [...entry.scopes];
  const domains: [string, ...string[]] = [...entry.domains];

  switch (entry.kind) {
    case "preset":
      return {
        kind: "preset",
        preset: entry.preset,
        provider: entry.provider,
        secretKey: entry.secretKey,
        scopeMode: entry.scopeMode,
        scopes,
        domains,
        expires: formatExpiry(entry.expiresAt),
      };
    case "custom":
      return {
        kind: "custom",
        secretKey: entry.secretKey,
        tokenUrl: entry.tokenUrl,
        scopes,
        domains,
        expires: formatExpiry(entry.expiresAt),
      };
    default: {
      const exhaustive: never = entry;

      return exhaustive;
    }
  }
}

function isFresh(credential: StoredOAuthCredential): boolean {
  return credential.expiresAt - Date.now() > REFRESH_MARGIN_MS;
}

function toSummary(credential: StoredOAuthCredential): OAuthLoginSummary {
  switch (credential.kind) {
    case "preset":
      return {
        kind: "preset",
        preset: credential.preset,
        provider: credential.provider,
        secretKey: credential.secretKey,
        scopeMode: credential.scopeMode,
        scopes: credential.scopes,
        domains: credential.domains,
        expiresAt: credential.expiresAt,
      };
    case "custom":
      return {
        kind: "custom",
        secretKey: credential.secretKey,
        tokenUrl: credential.tokenUrl,
        scopes: credential.scopes,
        domains: credential.domains,
        expiresAt: credential.expiresAt,
      };
    default: {
      const exhaustive: never = credential;

      return exhaustive;
    }
  }
}

async function readClientCredentials(
  secrets: SecretStore,
  options: {
    label: string;
    clientIdSecretKey: SecretKey;
    clientSecretSecretKey?: SecretKey | undefined;
  },
): Promise<{ clientId: string; clientSecret?: string }> {
  const clientId = await secrets.get(options.clientIdSecretKey);

  if (clientId === undefined) {
    throw new RpcError(
      400,
      `Missing ${options.label} OAuth client ID (${options.clientIdSecretKey}).`,
    );
  }

  if (options.clientSecretSecretKey === undefined) {
    return { clientId: clientId.value };
  }

  const clientSecret = await secrets.get(options.clientSecretSecretKey);

  if (clientSecret === undefined) {
    throw new RpcError(
      400,
      `Missing ${options.label} OAuth client secret (${options.clientSecretSecretKey}).`,
    );
  }

  return { clientId: clientId.value, clientSecret: clientSecret.value };
}

function refreshTargetFor(credential: StoredOAuthCredential) {
  switch (credential.kind) {
    case "preset": {
      const provider = getOAuthProvider(credential.provider);

      return {
        label: provider.label,
        tokenUrl: provider.tokenUrl,
        clientIdSecretKey: provider.clientIdSecretKey,
        clientSecretSecretKey: provider.clientSecretSecretKey,
      };
    }
    case "custom":
      return {
        label: credential.secretKey,
        tokenUrl: credential.tokenUrl,
        clientIdSecretKey: credential.clientIdSecretKey,
        clientSecretSecretKey: credential.clientSecretSecretKey,
      };
    default: {
      const exhaustive: never = credential;

      return exhaustive;
    }
  }
}

async function preparePresetFlow(
  secrets: SecretStore,
  presetId: OAuthPresetId,
  requestedScopeMode?: OAuthScopeMode,
): Promise<PreparedOAuthFlow> {
  const preset = getOAuthPreset(presetId);

  if (preset === undefined) {
    throw new RpcError(400, `unknown OAuth preset "${presetId}"`);
  }

  const provider = getOAuthProvider(preset.provider);
  const scopeMode = requestedScopeMode ?? preset.defaultScopeMode;
  const scopes = preset.scopes[scopeMode];
  const { clientId, clientSecret } = await readClientCredentials(secrets, {
    label: provider.label,
    clientIdSecretKey: provider.clientIdSecretKey,
    clientSecretSecretKey: provider.clientSecretSecretKey,
  });

  return {
    config: {
      label: provider.label,
      authorizationUrl: provider.authorizationUrl,
      tokenUrl: provider.tokenUrl,
      scopes,
      clientId,
      clientSecret,
      extraAuthParams: provider.extraAuthParams,
    },
    buildCredential: (tokens) => ({
      kind: "preset",
      preset: preset.id,
      provider: preset.provider,
      secretKey: preset.secretKey,
      scopeMode,
      scopes: [...scopes],
      domains: [...preset.domains],
      ...tokens,
    }),
  };
}

async function prepareCustomFlow(
  secrets: SecretStore,
  rawInput: CustomOAuthLoginInput,
): Promise<PreparedOAuthFlow> {
  const input = customOAuthLoginSchema.parse(rawInput);
  const { clientId, clientSecret } = await readClientCredentials(secrets, {
    label: input.secretKey,
    clientIdSecretKey: input.clientIdSecretKey,
    clientSecretSecretKey: input.clientSecretSecretKey,
  });

  return {
    config: {
      label: input.secretKey,
      authorizationUrl: input.authorizationUrl,
      tokenUrl: input.tokenUrl,
      scopes: input.scopes,
      clientId,
      clientSecret,
      extraAuthParams: input.extraAuthParams,
    },
    buildCredential: (tokens) => ({
      kind: "custom",
      secretKey: input.secretKey,
      authorizationUrl: input.authorizationUrl,
      tokenUrl: input.tokenUrl,
      clientIdSecretKey: input.clientIdSecretKey,
      ...(input.clientSecretSecretKey !== undefined
        ? { clientSecretSecretKey: input.clientSecretSecretKey }
        : {}),
      scopes: input.scopes,
      domains: input.domains,
      ...tokens,
    }),
  };
}

/**
 * Generic OAuth2 authorization-code + PKCE store for daemon-held integration tokens. One JSON file
 * per secret key, readable only by the daemon's OS user. Writes and refreshes per key are
 * serialized so a rotated refresh token is never raced.
 */
export function createOAuthStore(dataDir: string, secrets: SecretStore): OAuthStore {
  const files = createKeyedJsonStore({
    dir: join(dataDir, "oauth"),
    keySchema: secretKeySchema,
    valueSchema: storedOAuthCredentialSchema,
  });
  const { withLock } = createKeyedLock<SecretKey>();
  const webFlows = createWebOAuthFlowStore<(tokens: OAuthTokenBundle) => StoredOAuthCredential>();

  const saveCredential = async (credential: StoredOAuthCredential): Promise<OAuthLoginSummary> => {
    await withLock(credential.secretKey, () => files.write(credential.secretKey, credential));

    return toSummary(credential);
  };

  const refresh = (key: SecretKey, staleToken?: string) =>
    withLock(key, async (): Promise<StoredOAuthCredential | undefined> => {
      const stored = await files.read(key);

      if (stored === undefined) {
        return undefined;
      }

      if (isFresh(stored) && (staleToken === undefined || stored.accessToken !== staleToken)) {
        return stored;
      }

      const target = refreshTargetFor(stored);
      const { clientId, clientSecret } = await readClientCredentials(secrets, target);
      const token = await postTokenForm(target.tokenUrl, {
        grant_type: "refresh_token",
        refresh_token: stored.refreshToken,
        client_id: clientId,
        ...(clientSecret !== undefined ? { client_secret: clientSecret } : {}),
      });
      const updated: StoredOAuthCredential = {
        ...stored,
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? stored.refreshToken,
        expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
      };

      await files.write(key, updated);

      return updated;
    });

  return {
    async startWebPresetLogin(presetId, options) {
      const prepared = await preparePresetFlow(secrets, presetId, options.scopeMode);

      return webFlows.start(prepared.config, options.redirectUri, prepared.buildCredential);
    },
    async startWebCustomLogin(rawInput, redirectUri) {
      const prepared = await prepareCustomFlow(secrets, rawInput);

      return webFlows.start(prepared.config, redirectUri, prepared.buildCredential);
    },
    async completeWebLogin(callback) {
      const { tokens, payload: buildCredential } = await webFlows.complete(callback);

      return saveCredential(buildCredential(tokens));
    },
    async logout(target) {
      const preset = getOAuthPreset(target);
      let key: SecretKey;

      if (preset !== undefined) {
        key = preset.secretKey;
      } else {
        const parsed = secretKeySchema.safeParse(target);

        if (!parsed.success) {
          throw new RpcError(400, `invalid OAuth target "${target}"`);
        }

        key = parsed.data;
      }

      await withLock(key, () => files.delete(key));

      return key;
    },
    async list() {
      return (await files.entries()).map(({ value }) => toSummary(value));
    },
    has: async (key) => (await files.read(key)) !== undefined,
    async access(key, options) {
      const stored = await files.read(key);

      if (stored === undefined) {
        return undefined;
      }

      const credential =
        options?.staleToken === undefined && isFresh(stored)
          ? stored
          : await refresh(key, options?.staleToken);

      if (credential === undefined) {
        return undefined;
      }

      return { token: credential.accessToken, domains: credential.domains };
    },
  };
}
