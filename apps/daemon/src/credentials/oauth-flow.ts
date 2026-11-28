import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const OAUTH_LOGIN_TIMEOUT_MS = 5 * 60_000;
const TOKEN_TIMEOUT_MS = 30_000;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

export interface OAuthTokenBundle {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface OAuthFlowConfig {
  readonly label: string;
  readonly authorizationUrl: string;
  readonly tokenUrl: string;
  readonly scopes: readonly string[];
  readonly clientId: string;
  readonly clientSecret?: string | undefined;
  readonly extraAuthParams?: Readonly<Record<string, string>> | undefined;
}

export interface WebOAuthCallbackInput {
  readonly state: string | null;
  readonly code: string | null;
  readonly error: string | null;
  readonly errorDescription: string | null;
}

interface PendingWebFlow<T> {
  readonly state: string;
  readonly expiresAt: number;
  readonly redirectUri: string;
  readonly verifier: string;
  readonly config: OAuthFlowConfig;
  readonly payload: T;
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

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderOAuthCallbackHtml(
  title: string,
  message: string,
  options?: { returnLink?: boolean },
): string {
  const link = options?.returnLink ? '<p><a href="/">Return to Tetherbox</a></p>' : "";

  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${link}</body></html>`;
}

function buildAuthorizationUrl(options: {
  authorizationUrl: string;
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
  challenge: string;
  extraAuthParams?: Readonly<Record<string, string>> | undefined;
}): string {
  const authUrl = new URL(options.authorizationUrl);

  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", options.clientId);
  authUrl.searchParams.set("redirect_uri", options.redirectUri);
  authUrl.searchParams.set("scope", options.scopes.join(" "));
  authUrl.searchParams.set("state", options.state);
  authUrl.searchParams.set("code_challenge", options.challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  for (const [param, value] of Object.entries(options.extraAuthParams ?? {})) {
    authUrl.searchParams.set(param, value);
  }

  return authUrl.toString();
}

export async function postTokenForm(
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

async function exchangeAuthorizationCode(options: {
  label: string;
  tokenUrl: string;
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string | undefined;
  verifier: string;
}): Promise<OAuthTokenBundle> {
  const token = await postTokenForm(options.tokenUrl, {
    grant_type: "authorization_code",
    code: options.code,
    redirect_uri: options.redirectUri,
    client_id: options.clientId,
    ...(options.clientSecret !== undefined ? { client_secret: options.clientSecret } : {}),
    code_verifier: options.verifier,
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

export function createWebOAuthFlowStore<T>() {
  const pending = new Map<string, PendingWebFlow<T>>();

  const prune = () => {
    const now = Date.now();

    for (const [state, flow] of pending) {
      if (flow.expiresAt <= now) {
        pending.delete(state);
      }
    }
  };

  return {
    start(config: OAuthFlowConfig, redirectUri: string, payload: T): { authorizationUrl: string } {
      prune();

      const state = randomBytes(24).toString("base64url");
      const pkce = createPkce();
      const authorizationUrl = buildAuthorizationUrl({
        authorizationUrl: config.authorizationUrl,
        clientId: config.clientId,
        redirectUri,
        scopes: config.scopes,
        state,
        challenge: pkce.challenge,
        extraAuthParams: config.extraAuthParams,
      });

      pending.set(state, {
        state,
        expiresAt: Date.now() + OAUTH_LOGIN_TIMEOUT_MS,
        redirectUri,
        verifier: pkce.verifier,
        config,
        payload,
      });

      return { authorizationUrl };
    },
    async complete(
      callback: WebOAuthCallbackInput,
    ): Promise<{ tokens: OAuthTokenBundle; payload: T }> {
      prune();

      if (callback.state === null || callback.state === "") {
        throw new Error("Missing OAuth state parameter");
      }

      let matched: PendingWebFlow<T> | undefined;

      for (const flow of pending.values()) {
        if (sameState(flow.state, callback.state)) {
          matched = flow;
          break;
        }
      }

      if (matched === undefined) {
        throw new Error("OAuth state mismatch or expired login session");
      }

      pending.delete(matched.state);

      if (callback.error !== null) {
        const detail = callback.errorDescription
          ? `${callback.error}: ${callback.errorDescription}`
          : callback.error;

        throw new Error(`OAuth authorization failed: ${detail}`);
      }

      if (callback.code === null || callback.code.trim() === "") {
        throw new Error("OAuth callback did not include a code");
      }

      const tokens = await exchangeAuthorizationCode({
        label: matched.config.label,
        tokenUrl: matched.config.tokenUrl,
        code: callback.code,
        redirectUri: matched.redirectUri,
        clientId: matched.config.clientId,
        clientSecret: matched.config.clientSecret,
        verifier: matched.verifier,
      });

      return { tokens, payload: matched.payload };
    },
  };
}
