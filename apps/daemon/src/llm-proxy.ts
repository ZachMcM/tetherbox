import { RUN_TOKEN_HEADER, SECRET_KEY_HEADER, type LlmProvider } from "@tetherbox/core";
import type { SecretStore } from "./secret-store.ts";

type RequestAuthSlot = "bearer" | "x-api-key" | "x-goog-api-key";

export type LlmAuth =
  | { readonly kind: "bearer" }
  | { readonly kind: "header"; readonly name: string }
  | { readonly kind: "match-request"; readonly fallback: RequestAuthSlot };

export interface LlmUpstream {
  readonly origin: `https://${string}`;
  readonly pathPrefix?: `/${string}`;
  readonly auth: LlmAuth;
}

export interface ProxyLlmOptions {
  readonly fetch?: typeof fetch;
  readonly upstreams?: Readonly<Record<string, LlmUpstream>>;
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

const BEARER: LlmAuth = { kind: "bearer" };
const ANTHROPIC_KEY: LlmAuth = { kind: "header", name: "x-api-key" };
const GOOGLE_KEY: LlmAuth = { kind: "header", name: "x-goog-api-key" };
const MATCH_REQUEST_BEARER: LlmAuth = { kind: "match-request", fallback: "bearer" };

export const LLM_UPSTREAMS: Readonly<Record<string, LlmUpstream>> = {
  anthropic: { origin: "https://api.anthropic.com", auth: ANTHROPIC_KEY },
  openai: { origin: "https://api.openai.com", auth: BEARER },
  "openai-codex": { origin: "https://chatgpt.com", pathPrefix: "/backend-api", auth: BEARER },
  google: { origin: "https://generativelanguage.googleapis.com", auth: GOOGLE_KEY },
  openrouter: { origin: "https://openrouter.ai", pathPrefix: "/api", auth: MATCH_REQUEST_BEARER },
  opencode: { origin: "https://opencode.ai", pathPrefix: "/inference", auth: MATCH_REQUEST_BEARER },
  "opencode-go": {
    origin: "https://opencode.ai",
    pathPrefix: "/inference/go",
    auth: MATCH_REQUEST_BEARER,
  },
  xai: { origin: "https://api.x.ai", auth: BEARER },
  deepseek: { origin: "https://api.deepseek.com", auth: BEARER },
  groq: { origin: "https://api.groq.com", pathPrefix: "/openai", auth: BEARER },
  mistral: { origin: "https://api.mistral.ai", auth: BEARER },
  together: { origin: "https://api.together.ai", auth: BEARER },
  cerebras: { origin: "https://api.cerebras.ai", auth: BEARER },
  fireworks: {
    origin: "https://api.fireworks.ai",
    pathPrefix: "/inference",
    auth: MATCH_REQUEST_BEARER,
  },
  minimax: { origin: "https://api.minimax.io", pathPrefix: "/anthropic", auth: ANTHROPIC_KEY },
  "minimax-cn": {
    origin: "https://api.minimaxi.com",
    pathPrefix: "/anthropic",
    auth: ANTHROPIC_KEY,
  },
  moonshotai: { origin: "https://api.moonshot.ai", auth: BEARER },
  "moonshotai-cn": { origin: "https://api.moonshot.cn", auth: BEARER },
  baseten: { origin: "https://inference.baseten.co", auth: BEARER },
  huggingface: { origin: "https://router.huggingface.co", auth: BEARER },
  nvidia: { origin: "https://integrate.api.nvidia.com", auth: BEARER },
  "kimi-coding": { origin: "https://api.kimi.com", pathPrefix: "/coding", auth: BEARER },
  meta: { origin: "https://api.meta.ai", auth: BEARER },
  "vercel-ai-gateway": { origin: "https://ai-gateway.vercel.sh", auth: MATCH_REQUEST_BEARER },
  "github-copilot": {
    origin: "https://api.individual.githubcopilot.com",
    auth: MATCH_REQUEST_BEARER,
  },
  zai: { origin: "https://api.z.ai", pathPrefix: "/api/coding", auth: BEARER },
  "zai-coding-cn": { origin: "https://open.bigmodel.cn", pathPrefix: "/api/coding", auth: BEARER },
};

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

function detectRequestAuthSlot(headers: Headers, fallback: RequestAuthSlot): RequestAuthSlot {
  if (headers.has("x-api-key")) {
    return "x-api-key";
  }

  if (headers.has("x-goog-api-key")) {
    return "x-goog-api-key";
  }

  if (headers.has("authorization")) {
    return "bearer";
  }

  return fallback;
}

function applySlot(headers: Headers, slot: RequestAuthSlot, secretValue: string): void {
  switch (slot) {
    case "bearer":
      headers.set("authorization", `Bearer ${secretValue}`);
      break;
    case "x-api-key":
    case "x-goog-api-key":
      headers.set(slot, secretValue);
      break;
    default: {
      const exhaustive: never = slot;

      return exhaustive;
    }
  }
}

function applyAuth(
  headers: Headers,
  auth: LlmAuth,
  originalHeaders: Headers,
  secretValue: string,
): void {
  switch (auth.kind) {
    case "bearer":
      headers.set("authorization", `Bearer ${secretValue}`);
      break;
    case "header":
      headers.set(auth.name, secretValue);
      break;
    case "match-request":
      applySlot(headers, detectRequestAuthSlot(originalHeaders, auth.fallback), secretValue);
      break;
    default: {
      const exhaustive: never = auth;

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
  const routePrefix = `/llm/${provider}`;

  if (url.pathname !== routePrefix && !url.pathname.startsWith(`${routePrefix}/`)) {
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
  options: ProxyLlmOptions = {},
): Promise<Response> {
  const upstreams = options.upstreams ?? LLM_UPSTREAMS;
  const upstream = upstreams[provider];

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
  const fetchFn = options.fetch ?? fetch;
  let response: Response;

  try {
    response = await fetchFn(target, {
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
