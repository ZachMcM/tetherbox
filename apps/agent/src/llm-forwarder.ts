import { connect, createServer, type AddressInfo, type Server, type Socket } from "node:net";

export interface LlmForwarder {
  baseUrl(provider: string, upstreamBaseUrl?: string): string;
  close(): Promise<void>;
}

function basePathFor(upstreamBaseUrl: string | undefined): string {
  if (upstreamBaseUrl === undefined || upstreamBaseUrl === "") {
    return "";
  }

  const parsed = URL.parse(upstreamBaseUrl);

  if (parsed === null) {
    return "";
  }

  return parsed.pathname.replace(/\/+$/, "");
}

/**
 * Provider SDKs only speak TCP, so each run opens a loopback listener that pipes to the daemon's
 * Unix socket. Requests still need the run token, which the session sends as its API key.
 */
export async function startLlmForwarder(socketPath: string): Promise<LlmForwarder> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((client) => {
    const upstream = connect(socketPath);

    sockets.add(client);
    sockets.add(upstream);
    client.pipe(upstream).pipe(client);

    const teardown = () => {
      client.destroy();
      upstream.destroy();
    };

    client.once("error", teardown);
    upstream.once("error", teardown);
    client.once("close", () => {
      sockets.delete(client);
      upstream.destroy();
    });
    upstream.once("close", () => {
      sockets.delete(upstream);
      client.destroy();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: (provider, upstreamBaseUrl) =>
      `http://127.0.0.1:${port}/llm/${encodeURIComponent(provider)}${basePathFor(upstreamBaseUrl)}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());

        for (const socket of sockets) {
          socket.destroy();
        }
      }),
  };
}
