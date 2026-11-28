import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { profileIdSchema, type ProfileId, type SessionId } from "../../../ids.ts";
import type { SessionRecord, TranscriptEntry } from "../../../session.ts";
import { profileIdParam, sessionIdParam } from "../../params.ts";
import {
  createSessionInputSchema,
  sendSessionMessageInputSchema,
  updateSessionInputSchema,
  type CreateSessionInput,
  type SendSessionMessageInput,
  type UpdateSessionInput,
} from "../schemas.ts";

export interface SessionHandlers {
  list(profileId?: ProfileId): SessionRecord[];
  create(profileId: ProfileId, input: CreateSessionInput): SessionRecord;
  get(sessionId: SessionId): Promise<{ session: SessionRecord; entries: TranscriptEntry[] }>;
  sendMessage(
    sessionId: SessionId,
    input: SendSessionMessageInput,
  ): { accepted: true; sessionId: SessionId };
  abort(sessionId: SessionId): { aborted: boolean };
  update(sessionId: SessionId, input: UpdateSessionInput): SessionRecord;
  delete(sessionId: SessionId): Promise<void>;
}

export function createSessionRoutes(handlers: SessionHandlers) {
  return new Hono()
    .get(
      "/sessions",
      zValidator("query", z.object({ profileId: profileIdSchema.optional() })),
      (c) => c.json({ sessions: handlers.list(c.req.valid("query").profileId) }, 200),
    )
    .post(
      "/profiles/:profileId/sessions",
      zValidator("param", profileIdParam),
      zValidator("json", createSessionInputSchema),
      (c) =>
        c.json(
          { session: handlers.create(c.req.valid("param").profileId, c.req.valid("json")) },
          201,
        ),
    )
    .get("/sessions/:sessionId", zValidator("param", sessionIdParam), async (c) =>
      c.json(await handlers.get(c.req.valid("param").sessionId), 200),
    )
    .post(
      "/sessions/:sessionId/messages",
      zValidator("param", sessionIdParam),
      zValidator("json", sendSessionMessageInputSchema),
      (c) => c.json(handlers.sendMessage(c.req.valid("param").sessionId, c.req.valid("json")), 202),
    )
    .post("/sessions/:sessionId/abort", zValidator("param", sessionIdParam), (c) =>
      c.json(handlers.abort(c.req.valid("param").sessionId), 200),
    )
    .patch(
      "/sessions/:sessionId",
      zValidator("param", sessionIdParam),
      zValidator("json", updateSessionInputSchema),
      (c) =>
        c.json(
          { session: handlers.update(c.req.valid("param").sessionId, c.req.valid("json")) },
          200,
        ),
    )
    .delete("/sessions/:sessionId", zValidator("param", sessionIdParam), async (c) => {
      await handlers.delete(c.req.valid("param").sessionId);

      return c.body(null, 204);
    });
}
