import { z } from "zod";
import { profileIdSchema, runIdSchema, sessionIdSchema } from "./ids.ts";
import { turnModelAuthSchema } from "./llm-auth.ts";
import { modelRefSchema } from "./profile.ts";

export const turnTriggerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("user"),
    text: z.string().min(1),
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
  sessionId: sessionIdSchema,
  profileDir: z.string().min(1),
  sessionFile: z.string().min(1),
  socketPath: z.string().min(1),
  model: modelRefSchema,
  modelAuth: turnModelAuthSchema,
  trigger: turnTriggerSchema,
});
export type TurnInput = z.infer<typeof turnInputSchema>;

export const turnStreamEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text_delta"),
    delta: z.string(),
  }),
  z.object({
    kind: z.literal("thinking_delta"),
    delta: z.string(),
  }),
  z.object({
    kind: z.literal("tool_start"),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.unknown(),
  }),
  z.object({
    kind: z.literal("tool_update"),
    toolCallId: z.string(),
    toolName: z.string(),
    partialResult: z.unknown(),
  }),
  z.object({
    kind: z.literal("tool_end"),
    toolCallId: z.string(),
    toolName: z.string(),
    result: z.unknown(),
    isError: z.boolean(),
    durationMs: z.number().optional(),
  }),
  z.object({
    kind: z.literal("message_end"),
    message: z.unknown(),
  }),
  z.object({
    kind: z.literal("turn_end"),
    finalText: z.string().nullable(),
  }),
]);
export type TurnStreamEvent = z.infer<typeof turnStreamEventSchema>;
