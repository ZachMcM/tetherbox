import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { starterIdParam } from "../../params.ts";
import {
  checkStarterConnectionInputSchema,
  type CheckStarterConnectionInput,
  type StarterConnectionCheckResult,
  type StarterSummary,
} from "../schemas.ts";

export interface StarterHandlers {
  list(): StarterSummary[];
  checkConnection(
    starterId: string,
    input: CheckStarterConnectionInput,
  ): Promise<StarterConnectionCheckResult>;
  removeFromLibrary(starterId: string): Promise<void>;
}

export function createStarterRoutes(handlers: StarterHandlers) {
  return new Hono()
    .get("/starters", (c) => c.json({ starters: handlers.list() }, 200))
    .post(
      "/starters/:starterId/check",
      zValidator("param", starterIdParam),
      zValidator("json", checkStarterConnectionInputSchema),
      async (c) =>
        c.json(
          await handlers.checkConnection(c.req.valid("param").starterId, c.req.valid("json")),
          200,
        ),
    )
    .delete("/starters/:starterId", zValidator("param", starterIdParam), async (c) => {
      await handlers.removeFromLibrary(c.req.valid("param").starterId);

      return c.body(null, 204);
    });
}
