import {
  RUN_TOKEN_HEADER,
  SECRET_KEY_HEADER,
  type LlmAuthKind,
  type LlmProvider,
} from "@tetherbox/core";
import type { LlmAccess, LlmOAuth } from "./llm-oauth.ts";
import type { SecretStore } from "./secret-store.ts";

type AuthScheme = "bearer" | "x-api-key" | "x-goog-api-key";
type LlmAuth = AuthScheme | "match-request";

interface LlmUpstream {
  readonly origin: `https://${string}`;
  readonly pathPrefix?: `/${string}`;
  readonly auth: LlmAuth;
}

const HOP_BY_HOP_HEADERS = [
  "connection",
  "host",
  "keep-alive",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
] as const;

const STRIPPED_REQUEST_HEADERS = [
  ...HOP_BY_HOP_HEADERS,
  RUN_TOKEN_HEADER,
  SECRET_KEY_HEADER,
  "authorization",
  "x-api-key",
  "x-goog-api-key",
] as const;

const STRIPPED_RESPONSE_HEADERS = [
  ...HOP_BY_HOP_HEADERS,
  "content-encoding",
  "content-length",
] as const;

const LLM_UPSTREAMS: Readonly<Record<LlmProvider, LlmUpstream>> = {
  anthropic: { origin: "https://api.anthropic.com", auth: "x-api-key" },
  openai: { origin: "https://api.openai.com", auth: "bearer" },
  "openai-codex": { origin: "https://chatgpt.com", pathPrefix: "/backend-api", auth: "bearer" },
  google: { origin: "https://generativelanguage.googleapis.com", auth: "x-goog-api-key" },
  openrouter: { origin: "https://openrouter.ai", pathPrefix: "/api", auth: "match-request" },
  opencode: { origin: "https://opencode.ai", pathPrefix: "/inference", auth: "match-request" },
  "opencode-go": {
    origin: "https://opencode.ai",
    pathPrefix: "/inference/go",
    auth: "match-request",
  },
  xai: { origin: "https://api.x.ai", auth: "bearer" },
  deepseek: { origin: "https://api.deepseek.com", auth: "bearer" },
  groq: { origin: "https://api.groq.com", pathPrefix: "/openai", auth: "bearer" },
  mistral: { origin: "https://api.mistral.ai", auth: "bearer" },
  together: { origin: "https://api.together.ai", auth: "bearer" },
  cerebras: { origin: "https://api.cerebras.ai", auth: "bearer" },
  fireworks: {
    origin: "https://api.fireworks.ai",
    pathPrefix: "/inference",
    auth: "match-request",
  },
  minimax: { origin: "https://api.minimax.io", pathPrefix: "/anthropic", auth: "x-api-key" },
  "minimax-cn": {
    origin: "https://api.minimaxi.com",
    pathPrefix: "/anthropic",
    auth: "x-api-key",
  },
  moonshotai: { origin: "https://api.moonshot.ai", auth: "bearer" },
  "moonshotai-cn": { origin: "https://api.moonshot.cn", auth: "bearer" },
  baseten: { origin: "https://inference.baseten.co", auth: "bearer" },
  huggingface: { origin: "https://router.huggingface.co", auth: "bearer" },
  nvidia: { origin: "https://integrate.api.nvidia.com", auth: "bearer" },
  "kimi-coding": { origin: "https://api.kimi.com", pathPrefix: "/coding", auth: "bearer" },
  meta: { origin: "https://api.meta.ai", auth: "bearer" },
  "vercel-ai-gateway": { origin: "https://ai-gateway.vercel.sh", auth: "match-request" },
  "github-copilot": {
    origin: "https://api.individual.githubcopilot.com",
    auth: "match-request",
  },
  zai: { origin: "https://api.z.ai", pathPrefix: "/api/coding", auth: "bearer" },
  "zai-coding-cn": {
    origin: "https://open.bigmodel.cn",
    pathPrefix: "/api/coding",
    auth: "bearer",
  },
};

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

function detectRequestAuth(headers: Headers): AuthScheme {
  if (headers.has("x-api-key")) {
    return "x-api-key";
  }

  if (headers.has("x-goog-api-key")) {
    return "x-goog-api-key";
  }

  return "bearer";
}

function applyAuth(
  headers: Headers,
  auth: LlmAuth,
  originalHeaders: Headers,
  secretValue: string,
): void {
  const scheme = auth === "match-request" ? detectRequestAuth(originalHeaders) : auth;

  switch (scheme) {
    case "bearer":
      headers.set("authorization", `Bearer ${secretValue}`);
      break;
    case "x-api-key":
    case "x-goog-api-key":
      headers.set(scheme, secretValue);
      break;
    default: {
      const exhaustive: never = scheme;

      return exhaustive;
    }
  }
}

function matchesPathPrefix(pathname: string, prefix: `/${string}`): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function buildTargetUrl(
  requestUrl: string,
  provider: LlmProvider,
  upstream: LlmUpstream,
): URL | Response {
  const url = new URL(requestUrl);
  const routePrefix: `/${string}` = `/llm/${provider}`;

  if (!matchesPathPrefix(url.pathname, routePrefix)) {
    return fail(400, `expected ${routePrefix}/<path>`);
  }

  const restPath = url.pathname.slice(routePrefix.length) || "/";

  if (/%2e/i.test(restPath) || /%5c/i.test(restPath)) {
    return fail(400, "encoded path traversal is not allowed");
  }

  const target = URL.parse(`${upstream.origin}${restPath}${url.search}`);

  if (
    target === null ||
    target.origin !== upstream.origin ||
    target.username !== "" ||
    target.password !== ""
  ) {
    return fail(400, "invalid upstream path");
  }

  if (
    upstream.pathPrefix !== undefined &&
    !matchesPathPrefix(target.pathname, upstream.pathPrefix)
  ) {
    return fail(403, `provider ${provider} only allows paths under ${upstream.pathPrefix}`);
  }

  return target;
}

export interface LlmCredentialSources {
  secrets: SecretStore;
  oauth: LlmOAuth;
}

export interface ProxyLlmInput {
  provider: LlmProvider;
  authKind: LlmAuthKind;
  request: Request;
}

async function resolveAccess(
  sources: LlmCredentialSources,
  provider: LlmProvider,
  authKind: LlmAuthKind,
): Promise<LlmAccess | Response> {
  switch (authKind) {
    case "api-key": {
      const secret = await sources.secrets.getLlm(provider);

      return secret === undefined
        ? fail(404, `no LLM secret configured for provider "${provider}"`)
        : { token: secret.value, baseUrl: undefined };
    }
    case "oauth": {
      try {
        const access = await sources.oauth.access(provider);

        return access ?? fail(404, `no OAuth login for provider "${provider}"`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        return fail(502, `could not refresh the ${provider} OAuth login: ${message}`);
      }
    }
    default: {
      const exhaustive: never = authKind;

      return exhaustive;
    }
  }
}

function withCredentialOrigin(
  upstream: LlmUpstream,
  baseUrl: string | undefined,
): LlmUpstream | Response {
  if (baseUrl === undefined) {
    return upstream;
  }

  const parsed = URL.parse(baseUrl);

  if (parsed === null || parsed.protocol !== "https:") {
    return fail(502, "the OAuth login returned a base URL that is not https");
  }

  return { ...upstream, origin: `https://${parsed.host}` };
}

/**
 * The agent's Pi session points every provider's base URL at `/llm/<provider>` and authenticates
 * with its run token, so provider credentials never leave the daemon. An OAuth token goes in
 * whichever auth header the request used, since Pi already formatted the request for it. A base
 * URL from an OAuth login, such as a Copilot account's endpoint, comes from the daemon's own
 * credential, so it replaces the upstream origin.
 */
export async function proxyLlm(
  sources: LlmCredentialSources,
  { provider, authKind, request }: ProxyLlmInput,
): Promise<Response> {
  const catalogUpstream = LLM_UPSTREAMS[provider];
  const pathError = buildTargetUrl(request.url, provider, catalogUpstream);

  if (pathError instanceof Response) {
    return pathError;
  }

  const access = await resolveAccess(sources, provider, authKind);

  if (access instanceof Response) {
    return access;
  }

  const upstream = withCredentialOrigin(catalogUpstream, access.baseUrl);

  if (upstream instanceof Response) {
    return upstream;
  }

  const target = buildTargetUrl(request.url, provider, upstream);

  if (target instanceof Response) {
    return target;
  }

  const headers = new Headers(request.headers);

  for (const name of STRIPPED_REQUEST_HEADERS) {
    headers.delete(name);
  }

  applyAuth(
    headers,
    authKind === "oauth" ? "match-request" : upstream.auth,
    request.headers,
    access.token,
  );

  const hasBody = request.body !== null && request.method !== "GET" && request.method !== "HEAD";
  let response: Response;

  try {
    response = await fetch(target, {
      method: request.method,
      headers,
      redirect: "manual",
      signal: request.signal,
      ...(hasBody ? { body: request.body, duplex: "half" } : {}),
    });
  } catch (error) {
    if (request.signal.aborted) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);

    return fail(502, `upstream request to ${provider} failed: ${message}`);
  }

  const responseHeaders = new Headers(response.headers);

  for (const name of STRIPPED_RESPONSE_HEADERS) {
    responseHeaders.delete(name);
  }

  return new Response(response.body, { status: response.status, headers: responseHeaders });
}
