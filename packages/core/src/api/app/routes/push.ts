import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { pushSubscriptionInputSchema, type PushSubscriptionInput } from "../../../session.ts";
import { deletePushSubscriptionInputSchema } from "../schemas.ts";

export interface PushHandlers {
  getVapidPublicKey(): { publicKey: string };
  upsertSubscription(input: PushSubscriptionInput): void;
  deleteSubscription(endpoint: string): { deleted: boolean };
}

export function createPushRoutes(handlers: PushHandlers) {
  return new Hono()
    .get("/push/vapid-key", (c) => c.json(handlers.getVapidPublicKey(), 200))
    .post("/push/subscriptions", zValidator("json", pushSubscriptionInputSchema), (c) => {
      handlers.upsertSubscription(c.req.valid("json"));

      return c.body(null, 204);
    })
    .delete("/push/subscriptions", zValidator("json", deletePushSubscriptionInputSchema), (c) =>
      c.json(handlers.deleteSubscription(c.req.valid("json").endpoint), 200),
    );
}
