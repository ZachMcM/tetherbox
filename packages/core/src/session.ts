import { z } from "zod";
import { profileIdSchema, runIdSchema, sessionIdSchema } from "./ids.ts";
import { turnStreamEventSchema, turnTriggerSchema } from "./turn.ts";

export const sessionTriggerKindSchema = z.enum(["user", "cron", "webhook", "poll", "reminder"]);
export type SessionTriggerKind = z.infer<typeof sessionTriggerKindSchema>;

export const sessionStatusSchema = z.enum(["idle", "running", "error"]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const sessionRecordSchema = z.object({
  id: sessionIdSchema,
  profileId: profileIdSchema,
  title: z.string().min(1),
  triggerKind: sessionTriggerKindSchema,
  status: sessionStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  lastReadAt: z.iso.datetime().nullable(),
  unreadAlert: z.boolean(),
  errorMessage: z.string().nullable(),
});
export type SessionRecord = z.infer<typeof sessionRecordSchema>;

export const pushSubscriptionInputSchema = z.object({
  endpoint: z.url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInputSchema>;

export const pushSubscriptionSchema = pushSubscriptionInputSchema.extend({
  createdAt: z.iso.datetime(),
});
export type PushSubscriptionRecord = z.infer<typeof pushSubscriptionSchema>;

export const transcriptEntrySchema = z.looseObject({
  type: z.string(),
  id: z.string().optional(),
  parentId: z.string().nullable().optional(),
  timestamp: z.string().optional(),
});
export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>;

export const daemonEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("session_updated"),
    session: sessionRecordSchema,
  }),
  z.object({
    kind: z.literal("session_deleted"),
    profileId: profileIdSchema,
    sessionId: sessionIdSchema,
  }),
  z.object({
    kind: z.literal("turn_started"),
    profileId: profileIdSchema,
    sessionId: sessionIdSchema,
    runId: runIdSchema,
    trigger: turnTriggerSchema,
  }),
  z.object({
    kind: z.literal("turn_event"),
    profileId: profileIdSchema,
    sessionId: sessionIdSchema,
    runId: runIdSchema,
    event: turnStreamEventSchema,
  }),
  z.object({
    kind: z.literal("turn_finished"),
    profileId: profileIdSchema,
    sessionId: sessionIdSchema,
    runId: runIdSchema,
    status: z.enum(["idle", "error"]),
    errorMessage: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("notification"),
    profileId: profileIdSchema,
    sessionId: sessionIdSchema,
    title: z.string().optional(),
    body: z.string(),
  }),
]);
export type DaemonEvent = z.infer<typeof daemonEventSchema>;
