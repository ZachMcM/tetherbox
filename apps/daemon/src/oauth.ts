import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import {
  customOAuthLoginSchema,
  getOAuthPreset,
  getOAuthProvider,
  hostnameSchema,
  oauthPresetSchema,
  oauthProviderSchema,
  oauthScopeModeSchema,
  secretKeySchema,
  type CustomOAuthLoginInput,
  type OAuthPresetId,
  type OAuthProviderId,
  type OAuthScopeMode,
  type SecretKey,
} from "@tetherbox/core";
import { z } from "zod";
import { createKeyedJsonStore, createKeyedLock } from "./file-store.ts";
import type { SecretStore } from "./secret-store.ts";

const REFRESH_MARGIN_MS = 60_000;
const TOKEN_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000;

const storedOAuthCredentialBase = {
  secretKey: secretKeySchema,
  scopes: z.array(z.string().min(1)).nonempty(),
  domains: z.array(hostnameSchema).nonempty(),
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

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

export type OAuthLoginSummary =
  | {
      readonly kind: "preset";
      readonly preset: OAuthPresetId;
      readonly provider: OAuthProviderId;
      readonly secretKey: SecretKey;
      readonly scopeMode: OAuthScopeMode;
      readonly scopes: readonly string[];
      readonly domains: readonly string[];
      readonly expiresAt: number;
    }
  | {
      readonly kind: "custom";
      readonly secretKey: SecretKey;
      readonly tokenUrl: string;
      readonly scopes: readonly string[];
      readonly domains: readonly string[];
      readonly expiresAt: number;
    };

export interface OAuthAccess {
  readonly token: string;
  readonly domains: readonly string[];
}

export interface OAuthAccessOptions {
  readonly staleToken?: string;
}

export interface OAuthStore {
  loginPreset(presetId: OAuthPresetId, scopeMode?: OAuthScopeMode): Promise<OAuthLoginSummary>;
  loginCustom(input: CustomOAuthLoginInput): Promise<OAuthLoginSummary>;
  logout(target: string): Promise<SecretKey>;
  list(): Promise<OAuthLoginSummary[]>;
  has(secretKey: SecretKey): Promise<boolean>;
  access(secretKey: SecretKey, options?: OAuthAccessOptions): Promise<OAuthAccess | undefined>;
}

function isFresh(credential: StoredOAuthCredential): boolean {
  return credential.expiresAt - Date.now() > REFRESH_MARGIN_MS;
}

function sameState(expected: string, actual: string): boolean {
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(actual, "utf8");

  return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
}

function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  return { verifier, challenge };
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

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sendHtml(res: ServerResponse, status: number, title: string, message: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(
    `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body></html>`,
  );
}

async function waitForAuthorizationCode(options: {
  port: number;
  path: string;
  expectedState: string;
  authUrl: string;
}): Promise<string> {
  const { port, path, expectedState, authUrl } = options;

  return new Promise<string>((resolve, reject) => {
    let settled = false;

    const finish = (outcome: { kind: "ok"; code: string } | { kind: "err"; error: Error }) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      process.off("SIGINT", onSigint);
      server.close();

      if (outcome.kind === "ok") {
        resolve(outcome.code);
      } else {
        reject(outcome.error);
      }
    };

    const onSigint = () => finish({ kind: "err", error: new Error("OAuth login cancelled") });
    const timer = setTimeout(
      () => finish({ kind: "err", error: new Error("OAuth login timed out waiting for callback") }),
      LOGIN_TIMEOUT_MS,
    );

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const requestUrl = URL.parse(req.url ?? "/", `http://127.0.0.1:${port}`);

      if (requestUrl === null || requestUrl.pathname !== path) {
        res.writeHead(404);
        res.end("Not found");

        return;
      }

      const state = requestUrl.searchParams.get("state");

      if (state === null || !sameState(expectedState, state)) {
        sendHtml(res, 400, "Invalid state", "State mismatch. Restart the login from your CLI.");

        return;
      }

      const errorParam = requestUrl.searchParams.get("error");

      if (errorParam !== null) {
        const description = requestUrl.searchParams.get("error_description");
        const detail = description ? `${errorParam}: ${description}` : errorParam;

        sendHtml(res, 400, "Authorization failed", detail);
        finish({ kind: "err", error: new Error(`OAuth authorization failed: ${detail}`) });

        return;
      }

      const code = requestUrl.searchParams.get("code");

      if (code === null || code.trim() === "") {
        sendHtml(res, 400, "Missing code", "Authorization code was missing from the callback.");
        finish({ kind: "err", error: new Error("OAuth callback did not include a code") });

        return;
      }

      sendHtml(
        res,
        200,
        "Tetherbox connected",
        "Authorization complete. You can close this browser tab and return to your terminal.",
      );
      finish({ kind: "ok", code });
    });

    server.once("error", (error) => {
      finish({
        kind: "err",
        error: new Error(`Failed to listen on 127.0.0.1:${port}: ${error.message}`, {
          cause: error,
        }),
      });
    });

    process.once("SIGINT", onSigint);
    server.listen(port, "127.0.0.1", () => {
      console.log(`\nOpen this URL in your browser:\n\n  ${authUrl}\n`);
      console.log("Waiting for authorization callback...");
    });
  });
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
    throw new Error(
      `Missing ${options.label} OAuth client ID (${options.clientIdSecretKey}). Set it with \`tetherbox secrets set ${options.clientIdSecretKey}\` or run \`tetherbox oauth\`.`,
    );
  }

  if (options.clientSecretSecretKey === undefined) {
    return { clientId: clientId.value };
  }

  const clientSecret = await secrets.get(options.clientSecretSecretKey);

  if (clientSecret === undefined) {
    throw new Error(
      `Missing ${options.label} OAuth client secret (${options.clientSecretSecretKey}). Set it with \`tetherbox secrets set ${options.clientSecretSecretKey}\` or run \`tetherbox oauth\`.`,
    );
  }

  return { clientId: clientId.value, clientSecret: clientSecret.value };
}

async function postTokenForm(
  tokenUrl: string,
  params: Record<string, string>,
): Promise<z.infer<typeof tokenResponseSchema>> {
  const body = new URLSearchParams(params);
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`OAuth token endpoint returned ${response.status}: ${text.slice(0, 500)}`);
  }

  return tokenResponseSchema.parse(JSON.parse(text));
}

async function runAuthCodeFlow(options: {
  label: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: readonly string[];
  callbackPort: number;
  callbackPath: string;
  clientId: string;
  clientSecret?: string | undefined;
  extraAuthParams?: Readonly<Record<string, string>> | undefined;
}): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  const redirectUri = `http://127.0.0.1:${options.callbackPort}${options.callbackPath}`;
  const state = randomBytes(24).toString("base64url");
  const pkce = createPkce();
  const authUrl = new URL(options.authorizationUrl);

  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", options.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", options.scopes.join(" "));
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", pkce.challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  for (const [param, value] of Object.entries(options.extraAuthParams ?? {})) {
    authUrl.searchParams.set(param, value);
  }

  const code = await waitForAuthorizationCode({
    port: options.callbackPort,
    path: options.callbackPath,
    expectedState: state,
    authUrl: authUrl.toString(),
  });
  const token = await postTokenForm(options.tokenUrl, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: options.clientId,
    ...(options.clientSecret !== undefined ? { client_secret: options.clientSecret } : {}),
    code_verifier: pkce.verifier,
  });

  if (token.refresh_token === undefined) {
    throw new Error(
      `${options.label} did not return a refresh token. Ensure offline access / refresh tokens are enabled and re-authorize.`,
    );
  }

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
  };
}

function refreshTargetFor(credential: StoredOAuthCredential): {
  label: string;
  tokenUrl: string;
  clientIdSecretKey: SecretKey;
  clientSecretSecretKey?: SecretKey | undefined;
} {
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
    async loginPreset(presetId, requestedScopeMode) {
      const preset = getOAuthPreset(presetId);

      if (preset === undefined) {
        throw new Error(`unknown OAuth preset "${presetId}"`);
      }

      const provider = getOAuthProvider(preset.provider);
      const scopeMode = requestedScopeMode ?? preset.defaultScopeMode;
      const scopes = preset.scopes[scopeMode];
      const { clientId, clientSecret } = await readClientCredentials(secrets, {
        label: provider.label,
        clientIdSecretKey: provider.clientIdSecretKey,
        clientSecretSecretKey: provider.clientSecretSecretKey,
      });
      const tokens = await runAuthCodeFlow({
        label: provider.label,
        authorizationUrl: provider.authorizationUrl,
        tokenUrl: provider.tokenUrl,
        scopes,
        callbackPort: provider.callbackPort,
        callbackPath: provider.callbackPath,
        clientId,
        clientSecret,
        extraAuthParams: provider.extraAuthParams,
      });
      const credential: StoredOAuthCredential = {
        kind: "preset",
        preset: preset.id,
        provider: preset.provider,
        secretKey: preset.secretKey,
        scopeMode,
        scopes: [...scopes],
        domains: [...preset.domains],
        ...tokens,
      };

      await withLock(preset.secretKey, () => files.write(preset.secretKey, credential));

      return toSummary(credential);
    },
    async loginCustom(rawInput) {
      const input = customOAuthLoginSchema.parse(rawInput);
      const { clientId, clientSecret } = await readClientCredentials(secrets, {
        label: input.secretKey,
        clientIdSecretKey: input.clientIdSecretKey,
        clientSecretSecretKey: input.clientSecretSecretKey,
      });
      const tokens = await runAuthCodeFlow({
        label: input.secretKey,
        authorizationUrl: input.authorizationUrl,
        tokenUrl: input.tokenUrl,
        scopes: input.scopes,
        callbackPort: input.callbackPort,
        callbackPath: input.callbackPath,
        clientId,
        clientSecret,
        extraAuthParams: input.extraAuthParams,
      });
      const credential: StoredOAuthCredential = {
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
      };

      await withLock(input.secretKey, () => files.write(input.secretKey, credential));

      return toSummary(credential);
    },
    async logout(target) {
      const preset = getOAuthPreset(target);
      const key = preset !== undefined ? preset.secretKey : secretKeySchema.parse(target);

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
