import { RUN_TOKEN_HEADER, SECRET_KEY_HEADER, secretKeySchema } from "@tetherbox/core";
import type { OAuthStore } from "./oauth.ts";
import type { SecretStore } from "./secret-store.ts";

const HOP_BY_HOP_HEADERS = ["connection", "host", "keep-alive", "transfer-encoding", "upgrade"];
const PROXY_PATH = /^\/proxy\/([^/]+)(\/.*)?$/;

export interface SecretProxyDeps {
  readonly secrets: SecretStore;
  readonly oauth: OAuthStore;
}

function matchesPinnedDomain(host: string, domains: readonly string[]): boolean {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

function stripProxyHeaders(headers: Headers): Headers {
  const cleaned = new Headers(headers);

  for (const name of [...HOP_BY_HOP_HEADERS, SECRET_KEY_HEADER, RUN_TOKEN_HEADER]) {
    cleaned.delete(name);
  }

  return cleaned;
}

function wrapUpstream(upstream: Response): Response {
  const responseHeaders = new Headers(upstream.headers);

  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

/**
 * Forwards `/proxy/<host>/<path>` to `https://<host>/<path>`, injecting the secret or OAuth2
 * bearer token named in `x-tetherbox-secret` only when `<host>` is one of its pinned domains.
 */
export async function proxyWithSecret(
  { secrets, oauth }: SecretProxyDeps,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const match = PROXY_PATH.exec(url.pathname);
  const key = secretKeySchema.safeParse(request.headers.get(SECRET_KEY_HEADER));

  if (match === null || match[1] === undefined) {
    return fail(400, "expected /proxy/<host>/<path>");
  }

  if (!key.success) {
    return fail(400, `missing or invalid ${SECRET_KEY_HEADER} header`);
  }

  const target = URL.parse(`https://${match[1]}${match[2] ?? "/"}${url.search}`);

  if (target === null || target.username !== "" || target.password !== "" || target.port !== "") {
    return fail(400, "target must be a bare https host");
  }

  const secret = await secrets.get(key.data);

  if (secret !== undefined) {
    if (secret.binding.kind !== "proxy") {
      return fail(403, `secret ${key.data} is not bound for proxy use`);
    }

    if (!matchesPinnedDomain(target.hostname, secret.binding.domains)) {
      return fail(403, `secret ${key.data} is not pinned to ${target.hostname}`);
    }

    const headers = stripProxyHeaders(request.headers);
    const { inject } = secret.binding;

    switch (inject.kind) {
      case "bearer":
        headers.set("authorization", `Bearer ${secret.value}`);
        break;
      case "header":
        headers.set(inject.name, secret.value);
        break;
      case "query":
        target.searchParams.set(inject.name, secret.value);
        break;
      default: {
        const exhaustive: never = inject;

        return exhaustive;
      }
    }

    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.body,
      duplex: "half",
      redirect: "manual",
    });

    return wrapUpstream(upstream);
  }

  const oauthAccess = await oauth.access(key.data);

  if (oauthAccess === undefined) {
    return fail(404, `secret ${key.data} is not set`);
  }

  if (!matchesPinnedDomain(target.hostname, oauthAccess.domains)) {
    return fail(403, `secret ${key.data} is not pinned to ${target.hostname}`);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body !== null;
  const bodyBuffer = hasBody ? await request.arrayBuffer() : undefined;
  const sendWithToken = (token: string) => {
    const headers = stripProxyHeaders(request.headers);

    headers.set("authorization", `Bearer ${token}`);

    return fetch(target, {
      method: request.method,
      headers,
      ...(bodyBuffer !== undefined ? { body: bodyBuffer } : {}),
      redirect: "manual",
    });
  };

  let upstream = await sendWithToken(oauthAccess.token);

  if (upstream.status === 401) {
    const refreshed = await oauth.access(key.data, { staleToken: oauthAccess.token });

    if (refreshed !== undefined && refreshed.token !== oauthAccess.token) {
      await upstream.body?.cancel();
      upstream = await sendWithToken(refreshed.token);
    }
  }

  return wrapUpstream(upstream);
}
