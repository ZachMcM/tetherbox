import { RUN_TOKEN_HEADER, SECRET_KEY_HEADER, secretKeySchema } from "@tetherbox/core";
import type { SecretStore } from "./secret-store.ts";

const HOP_BY_HOP_HEADERS = ["connection", "host", "keep-alive", "transfer-encoding", "upgrade"];
const PROXY_PATH = /^\/proxy\/([^/]+)(\/.*)?$/;

function matchesPinnedDomain(host: string, domains: readonly string[]): boolean {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

/**
 * Forwards `/proxy/<host>/<path>` to `https://<host>/<path>`, injecting the secret named in
 * `x-tetherbox-secret` only when `<host>` is one of that secret's pinned domains.
 */
export async function proxyWithSecret(store: SecretStore, request: Request): Promise<Response> {
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

  const secret = await store.get(key.data);

  if (secret === undefined) {
    return fail(404, `secret ${key.data} is not set`);
  }

  if (!matchesPinnedDomain(target.hostname, secret.binding.domains)) {
    return fail(403, `secret ${key.data} is not pinned to ${target.hostname}`);
  }

  const headers = new Headers(request.headers);

  for (const name of [...HOP_BY_HOP_HEADERS, SECRET_KEY_HEADER, RUN_TOKEN_HEADER]) {
    headers.delete(name);
  }

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
  }

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: request.body,
    duplex: "half",
    redirect: "manual",
  });
  const responseHeaders = new Headers(upstream.headers);

  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
