import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { SecretKey } from "../../../ids.ts";
import type { SecretListEntry } from "../../../secrets.ts";
import { secretKeyParam } from "../params.ts";
import { setSecretInputSchema, type SetSecretInput } from "../schemas.ts";

export interface SecretHandlers {
  list(): Promise<SecretListEntry[]>;
  set(key: SecretKey, input: SetSecretInput): Promise<SecretListEntry>;
  delete(key: SecretKey): Promise<void>;
}

export function createSecretRoutes(handlers: SecretHandlers) {
  return new Hono()
    .get("/secrets", async (c) => c.json({ secrets: await handlers.list() }, 200))
    .put(
      "/secrets/:key",
      zValidator("param", secretKeyParam),
      zValidator("json", setSecretInputSchema),
      async (c) =>
        c.json({ secret: await handlers.set(c.req.valid("param").key, c.req.valid("json")) }, 200),
    )
    .delete("/secrets/:key", zValidator("param", secretKeyParam), async (c) => {
      await handlers.delete(c.req.valid("param").key);

      return c.body(null, 204);
    });
}
