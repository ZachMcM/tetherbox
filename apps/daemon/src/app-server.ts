import { existsSync } from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  bearerToken,
  createAppApi,
  parseForwardedProto,
  profileIdSchema,
  sessionIdSchema,
  type ProfileId,
} from "@tetherbox/core";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { APP_SESSION_COOKIE, verifyAppToken } from "./app-auth.ts";
import { createAppHandlers, type AppHandlerDeps } from "./app-handlers.ts";
import type { DaemonEvent } from "./events.ts";
import { renderOAuthCallbackHtml } from "./oauth-flow.ts";

const SSE_HEARTBEAT_MS = 25_000;

const loginInputSchema = z.object({
  token: z.string().trim().min(1),
});

export interface AppServerDeps extends AppHandlerDeps {
  appToken: string;
  shutdownSignal?: AbortSignal;
}

function isAuthenticated(c: Context, appToken: string): boolean {
  const headerToken = bearerToken(c.req.header("authorization"));

  if (verifyAppToken(appToken, headerToken)) {
    return true;
  }

  return verifyAppToken(appToken, getCookie(c, APP_SESSION_COOKIE));
}

function isSecureRequest(c: Context): boolean {
  const forwardedProto = parseForwardedProto(c.req.header("x-forwarded-proto"));

  if (forwardedProto !== undefined) {
    return forwardedProto === "https";
  }

  return URL.parse(c.req.url)?.protocol === "https:";
}

function matchesEventFilter(
  event: DaemonEvent,
  profileId: ProfileId | undefined,
  sessionId: string | undefined,
): boolean {
  if (event.kind === "cli_install_updated" || event.kind === "cli_auth_updated") {
    return profileId === undefined && sessionId === undefined;
  }

  if (event.kind === "session_updated") {
    if (profileId !== undefined && event.session.profileId !== profileId) {
      return false;
    }

    if (sessionId !== undefined && event.session.id !== sessionId) {
      return false;
    }

    return true;
  }

  if (profileId !== undefined && event.profileId !== profileId) {
    return false;
  }

  if (sessionId !== undefined && event.sessionId !== sessionId) {
    return false;
  }

  return true;
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

  app.get("/api/auth/status", (c) => c.json({ authenticated: isAuthenticated(c, appToken) }));

  app.post("/api/auth/login", async (c) => {
    const parsed = loginInputSchema.safeParse(await c.req.json().catch(() => null));

    if (!parsed.success) {
      return c.json({ error: "token is required" }, 400);
    }

    if (!verifyAppToken(appToken, parsed.data.token)) {
      return c.json({ error: "invalid token" }, 401);
    }

    setCookie(c, APP_SESSION_COOKIE, appToken, {
      httpOnly: true,
      sameSite: "Lax",
      secure: isSecureRequest(c),
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return c.json({ ok: true });
  });

  app.post("/api/auth/logout", (c) => {
    deleteCookie(c, APP_SESSION_COOKIE, { path: "/" });

    return c.body(null, 204);
  });

  app.get("/api/oauth/callback", async (c) => {
    try {
      const summary = await oauth.completeWebLogin({
        state: c.req.query("state") ?? null,
        code: c.req.query("code") ?? null,
        error: c.req.query("error") ?? null,
        errorDescription: c.req.query("error_description") ?? null,
      });

      return c.html(
        renderOAuthCallbackHtml(
          "Tetherbox connected",
          `Stored OAuth credentials for ${summary.secretKey}. You can close this tab or return to Tetherbox.`,
          { returnLink: true },
        ),
        200,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      return c.html(
        renderOAuthCallbackHtml("Authorization failed", message, { returnLink: true }),
        400,
      );
    }
  });

  app.use("/api/*", async (c, next) => {
    if (!isAuthenticated(c, appToken)) {
      return c.json({ error: "unauthorized" }, 401);
    }

    await next();
  });

  app.get("/api/events", (c) => {
    const rawProfileId = c.req.query("profileId");
    const rawSessionId = c.req.query("sessionId");
    const profileId = rawProfileId !== undefined ? profileIdSchema.safeParse(rawProfileId) : null;
    const sessionId = rawSessionId !== undefined ? sessionIdSchema.safeParse(rawSessionId) : null;

    if (profileId !== null && !profileId.success) {
      return c.json({ error: "invalid profileId" }, 400);
    }

    if (sessionId !== null && !sessionId.success) {
      return c.json({ error: "invalid sessionId" }, 400);
    }

    const filterProfileId = profileId?.data;
    const filterSessionId = sessionId?.data;

    return streamSSE(c, async (stream) => {
      if (shutdownSignal?.aborted) {
        return;
      }

      let closedFlag = false;
      const { promise: closed, resolve: resolveClosed } = Promise.withResolvers<void>();

      const unsubscribe = events.subscribe((event) => {
        if (closedFlag || !matchesEventFilter(event, filterProfileId, filterSessionId)) {
          return;
        }

        void stream.writeSSE({
          event: event.kind,
          data: JSON.stringify(event),
        });
      });

      const heartbeat = setInterval(() => {
        if (!closedFlag) {
          void stream.write(": keepalive\n\n");
        }
      }, SSE_HEARTBEAT_MS);

      heartbeat.unref();

      const close = () => {
        if (closedFlag) {
          return;
        }

        closedFlag = true;
        clearInterval(heartbeat);
        unsubscribe();
        shutdownSignal?.removeEventListener("abort", close);
        resolveClosed();
      };

      stream.onAbort(close);
      shutdownSignal?.addEventListener("abort", close, { once: true });

      await stream.writeSSE({
        event: "connected",
        data: JSON.stringify({ ok: true }),
      });

      await closed;
    });
  });

  app.route("/api", api);
  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  if (config.webDir !== undefined && existsSync(config.webDir)) {
    const root = config.webDir;

    app.use("/*", serveStatic({ root }));
    app.get("*", serveStatic({ root, path: "index.html" }));
  }

  return app;
}
