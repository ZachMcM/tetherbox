import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { InternalEnv, RunContext } from "../run-context.ts";
import { notifyInputSchema, type NotifyInput } from "../schemas.ts";

export interface NotifyHandlers {
  send(run: RunContext, input: NotifyInput): Promise<void> | void;
}

export function createNotifyRoutes(handlers: NotifyHandlers) {
  return new Hono<InternalEnv>().post(
    "/rpc/notify",
    zValidator("json", notifyInputSchema),
    async (c) => {
      await handlers.send(c.get("run"), c.req.valid("json"));

      return c.body(null, 204);
    },
  );
}
