import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { starterIdParam } from "../params.ts";
import type { StarterSummary } from "../schemas.ts";

export interface StarterHandlers {
  list(): StarterSummary[];
  removeFromLibrary(starterId: string): Promise<void>;
}

export function createStarterRoutes(handlers: StarterHandlers) {
  return new Hono()
    .get("/starters", (c) => c.json({ starters: handlers.list() }, 200))
    .delete("/starters/:starterId", zValidator("param", starterIdParam), async (c) => {
      await handlers.removeFromLibrary(c.req.valid("param").starterId);

      return c.body(null, 204);
    });
}
