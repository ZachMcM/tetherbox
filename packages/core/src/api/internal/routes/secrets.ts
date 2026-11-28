import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { SecretKey } from "../../../ids.ts";
import type { SecretCheckResult } from "../../../secrets.ts";
import { secretKeyParam } from "../../params.ts";
import type { InternalEnv } from "../run-context.ts";

export interface SecretCheckHandlers {
  check(key: SecretKey): Promise<SecretCheckResult>;
}

export function createSecretCheckRoutes(handlers: SecretCheckHandlers) {
  return new Hono<InternalEnv>().get(
    "/rpc/secrets/:key",
    zValidator("param", secretKeyParam),
    async (c) => c.json(await handlers.check(c.req.valid("param").key)),
  );
}
