import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { EntryName, ProfileId } from "../../../ids.ts";
import { profileEntryParam, profileIdParam, profileStarterParam } from "../params.ts";
import {
  createProfileInputSchema,
  updateMemoryInputSchema,
  updateProfileInputSchema,
  type CreateProfileInput,
  type ProfileDetail,
  type ProfileSummary,
  type UpdateProfileInput,
} from "../schemas.ts";

export interface ProfileHandlers {
  list(): Promise<ProfileSummary[]> | ProfileSummary[];
  get(id: ProfileId): Promise<ProfileDetail>;
  create(input: CreateProfileInput): Promise<ProfileDetail>;
  update(id: ProfileId, input: UpdateProfileInput): Promise<ProfileDetail>;
  updateMemory(id: ProfileId, content: string): Promise<{ content: string }>;
  delete(id: ProfileId): Promise<void>;
  updateStarter(id: ProfileId, starterId: string): Promise<ProfileDetail>;
  cancelPollJob(id: ProfileId, name: EntryName): { cancelled: boolean };
  cancelReminder(id: ProfileId, name: EntryName): { cancelled: boolean };
}

export function createProfileRoutes(handlers: ProfileHandlers) {
  return new Hono()
    .get("/profiles", async (c) => c.json({ profiles: await handlers.list() }, 200))
    .post("/profiles", zValidator("json", createProfileInputSchema), async (c) =>
      c.json({ profile: await handlers.create(c.req.valid("json")) }, 201),
    )
    .get("/profiles/:profileId", zValidator("param", profileIdParam), async (c) =>
      c.json({ profile: await handlers.get(c.req.valid("param").profileId) }, 200),
    )
    .patch(
      "/profiles/:profileId",
      zValidator("param", profileIdParam),
      zValidator("json", updateProfileInputSchema),
      async (c) =>
        c.json(
          { profile: await handlers.update(c.req.valid("param").profileId, c.req.valid("json")) },
          200,
        ),
    )
    .put(
      "/profiles/:profileId/memory",
      zValidator("param", profileIdParam),
      zValidator("json", updateMemoryInputSchema),
      async (c) =>
        c.json(
          await handlers.updateMemory(c.req.valid("param").profileId, c.req.valid("json").content),
          200,
        ),
    )
    .delete("/profiles/:profileId", zValidator("param", profileIdParam), async (c) => {
      await handlers.delete(c.req.valid("param").profileId);

      return c.body(null, 204);
    })
    .delete("/profiles/:profileId/poll-jobs/:name", zValidator("param", profileEntryParam), (c) => {
      const { profileId, name } = c.req.valid("param");

      return c.json(handlers.cancelPollJob(profileId, name), 200);
    })
    .delete("/profiles/:profileId/reminders/:name", zValidator("param", profileEntryParam), (c) => {
      const { profileId, name } = c.req.valid("param");

      return c.json(handlers.cancelReminder(profileId, name), 200);
    })
    .post(
      "/profiles/:profileId/starters/:starterId/update",
      zValidator("param", profileStarterParam),
      async (c) => {
        const { profileId, starterId } = c.req.valid("param");

        return c.json({ profile: await handlers.updateStarter(profileId, starterId) }, 200);
      },
    );
}
