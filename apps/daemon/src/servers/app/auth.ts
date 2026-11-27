import { bearerToken, parseForwardedProto } from "@tetherbox/core";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { APP_SESSION_COOKIE, verifyAppToken } from "./app-token.ts";

const loginInputSchema = z.object({
  token: z.string().trim().min(1),
});

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

export function requireAppToken(appToken: string): MiddlewareHandler {
  return async (c, next) => {
    if (!isAuthenticated(c, appToken)) {
      return c.json({ error: "unauthorized" }, 401);
    }

    await next();
  };
}

export function createAuthRoutes(appToken: string) {
  return new Hono()
    .get("/status", (c) => c.json({ authenticated: isAuthenticated(c, appToken) }))
    .post("/login", async (c) => {
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
    })
    .post("/logout", (c) => {
      deleteCookie(c, APP_SESSION_COOKIE, { path: "/" });

      return c.body(null, 204);
    });
}
