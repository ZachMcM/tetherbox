import { RUN_TOKEN_HEADER, SECRET_KEY_HEADER, type LlmProvider } from "@tetherbox/core";
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

const LLM_UPSTREAMS: Readonly<Record<string, LlmUpstream>> = {
  anthropic: { origin: "https://api.anthropic.com", auth: "x-api-key" },
  openai: { origin: "https://api.openai.com", auth: "bearer" },
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

/**
 * The agent's Pi session points every provider's base URL at `/llm/<provider>` and uses its run
 * token as the API key, so provider credentials never leave the daemon.
 */
export async function proxyLlm(
  store: SecretStore,
  provider: LlmProvider,
  request: Request,
): Promise<Response> {
  const upstream = LLM_UPSTREAMS[provider];

  if (upstream === undefined) {
    return fail(404, `unsupported LLM provider "${provider}"`);
  }

  const target = buildTargetUrl(request.url, provider, upstream);

  if (target instanceof Response) {
    return target;
  }

  // TODO: Support OAuth token refresh for BYO subscriptions (such as OpenCode Go and Codex) once
  // the daemon's OAuth store lands.
  const secret = await store.getLlm(provider);

  if (secret === undefined) {
    return fail(404, `no LLM secret configured for provider "${provider}"`);
  }

  const headers = new Headers(request.headers);

  for (const name of STRIPPED_REQUEST_HEADERS) {
    headers.delete(name);
  }

  applyAuth(headers, upstream.auth, request.headers, secret.value);

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
