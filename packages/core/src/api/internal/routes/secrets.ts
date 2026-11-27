import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { secretKeySchema, type SecretKey } from "../../../ids.ts";
import type { SecretCheckResult } from "../../../secrets.ts";
import type { InternalEnv } from "../run-context.ts";

export interface SecretCheckHandlers {
  check(key: SecretKey): Promise<SecretCheckResult>;
}

export function createSecretCheckRoutes(handlers: SecretCheckHandlers) {
  return new Hono<InternalEnv>().get(
    "/rpc/secrets/:key",
    zValidator("param", z.object({ key: secretKeySchema })),
    async (c) => c.json(await handlers.check(c.req.valid("param").key)),
  );
}
