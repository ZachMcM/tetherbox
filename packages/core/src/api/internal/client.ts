import { hc } from "hono/client";
import { Agent, fetch as undiciFetch } from "undici";
import type { InternalApi } from "./routes.ts";
import { RUN_TOKEN_HEADER, SECRET_KEY_HEADER } from "../headers.ts";

const SOCKET_ORIGIN = "http://tetherbox";

// The undici package and Node's bundled fetch declare the same API in separate type packages.
const fetchWithDispatcher = undiciFetch as unknown as (
  input: string | URL | Request,
  init: Omit<RequestInit, "dispatcher"> & { dispatcher: Agent },
) => Promise<Response>;

export interface InternalClientOptions {
  socketPath: string;
  runToken: string;
}

function createSocketFetch({ socketPath, runToken }: InternalClientOptions): typeof fetch {
  const dispatcher = new Agent({ connect: { socketPath } });

  return (input, init) => {
    const headers = new Headers(init?.headers);

    headers.set(RUN_TOKEN_HEADER, runToken);

    return fetchWithDispatcher(input, { ...init, headers, dispatcher });
  };
}

export function createInternalClient(options: InternalClientOptions) {
  return hc<InternalApi>(SOCKET_ORIGIN, { fetch: createSocketFetch(options) });
}

export type InternalClient = ReturnType<typeof createInternalClient>;

/**
 * Sends a request through the daemon's domain-pinned secret proxy. The daemon injects the secret
 * only when the target host is one of the secret's pinned domains.
 */
export function createSecretProxyFetch(options: InternalClientOptions) {
  const socketFetch = createSocketFetch(options);

  return (secretKey: string, url: string | URL, init?: RequestInit): Promise<Response> => {
    const target = new URL(url);

    if (target.protocol !== "https:") {
      throw new Error(`secret proxy only forwards https requests, got ${target.protocol}`);
    }

    const headers = new Headers(init?.headers);

    headers.set(SECRET_KEY_HEADER, secretKey);

    return socketFetch(`${SOCKET_ORIGIN}/proxy/${target.host}${target.pathname}${target.search}`, {
      ...init,
      headers,
    });
  };
}
