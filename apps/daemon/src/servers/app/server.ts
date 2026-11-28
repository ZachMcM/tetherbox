import { existsSync } from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import { createAppApi } from "@tetherbox/core";
import { Hono } from "hono";
import { createAuthRoutes, requireAppToken } from "./auth.ts";
import { createEventStreamHandler } from "./event-stream.ts";
import { createAppHandlers, type AppHandlerDeps } from "./handlers/index.ts";
import { createOAuthCallbackHandler } from "./oauth-callback.ts";

export interface AppServerDeps extends AppHandlerDeps {
  appToken: string;
  shutdownSignal?: AbortSignal;
}

/**
 * Private Hono app server for the web UI, SSE stream, and typed RPC endpoints. Exposed only on the
 * tailnet via Tailscale Serve and gated by the daemon's `app-token` so local unprivileged processes
 * (including `tetherbox-agent`) cannot hit admin routes over loopback.
 */
export function createAppServer(deps: AppServerDeps) {
  const { config, appToken, events, oauth, shutdownSignal } = deps;
  const api = createAppApi(createAppHandlers(deps));
  const app = new Hono();

  app.route("/api/auth", createAuthRoutes(appToken));
  app.get("/api/oauth/callback", createOAuthCallbackHandler(oauth));
  app.use("/api/*", requireAppToken(appToken));
  app.get("/api/events", createEventStreamHandler({ events, shutdownSignal }));
  app.route("/api", api);
  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  if (config.webDir !== undefined && existsSync(config.webDir)) {
    const root = config.webDir;

    app.use("/*", serveStatic({ root }));
    app.get("*", serveStatic({ root, path: "index.html" }));
  }

  return app;
}
