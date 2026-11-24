import { Hono } from "hono";

export function createOAuthRoutes() {
  // TODO: Generic OAuth2 authorization-code flow: a state store, per-provider client config
  // (Google first, with scoped permissions for gcal and gmail), token exchange into the secret
  // store, and a refresh job on the scheduler.
  return new Hono().get("/:provider/callback", (c) =>
    c.json({ error: `OAuth callback for ${c.req.param("provider")} is not implemented` }, 501),
  );
}
