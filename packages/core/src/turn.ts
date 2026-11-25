import { z } from "zod";
import { profileIdSchema, runIdSchema } from "./ids.ts";
import { turnModelAuthSchema } from "./llm-auth.ts";
import { modelRefSchema } from "./profile.ts";

export const turnTriggerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("slack"),
    userId: z.string(),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("cron"),
    job: z.string(),
    prompt: z.string(),
  }),
  z.object({
    kind: z.literal("webhook"),
    hook: z.string(),
    prompt: z.string(),
    payload: z.unknown(),
  }),
  z.object({
    kind: z.literal("poll"),
    job: z.string(),
    prompt: z.string(),
    status: z.enum(["done", "stalled"]),
    output: z.string(),
  }),
  z.object({
    kind: z.literal("reminder"),
    name: z.string(),
    prompt: z.string(),
  }),
]);
export type TurnTrigger = z.infer<typeof turnTriggerSchema>;

export const turnInputSchema = z.object({
  runId: runIdSchema,
  runToken: z.string().min(32),
  profileId: profileIdSchema,
  profileDir: z.string().min(1),
  socketPath: z.string().min(1),
  model: modelRefSchema,
  modelAuth: turnModelAuthSchema,
  trigger: turnTriggerSchema,
  threadTs: z.string().min(1).optional(),
});
export type TurnInput = z.infer<typeof turnInputSchema>;

export const turnResultSchema = z.object({
  finalText: z.string().nullable(),
});
export type TurnResult = z.infer<typeof turnResultSchema>;
