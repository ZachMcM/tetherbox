import { z } from "zod";
import { secretKeySchema } from "./ids.ts";

export const modelRefSchema = z.object({
  provider: z.string().min(1),
  id: z.string().min(1),
});
export type ModelRef = z.infer<typeof modelRefSchema>;

export const profileConfigSchema = z.object({
  name: z.string().min(1),
  slackChannelId: z.string().regex(/^[CDG][A-Z0-9]+$/),
  model: modelRefSchema,
  starters: z.array(z.string().min(1)).default([]),
});
export type ProfileConfig = z.infer<typeof profileConfigSchema>;

export const cronJobSchema = z.object({
  schedule: z.string().min(1),
  timezone: z.string().min(1).optional(),
  prompt: z.string().min(1),
});
export type CronJob = z.infer<typeof cronJobSchema>;

export const webhookVerificationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("hmac-sha256"),
    secretKey: secretKeySchema,
    header: z.string().min(1),
  }),
  z.object({ kind: z.literal("public") }),
]);
export type WebhookVerification = z.infer<typeof webhookVerificationSchema>;

export const webhookSchema = z.object({
  prompt: z.string().min(1),
  verify: webhookVerificationSchema,
});
export type Webhook = z.infer<typeof webhookSchema>;

export interface ProfileIssue {
  file: string;
  message: string;
}

export type ProfileValidation = { ok: true } | { ok: false; issues: ProfileIssue[] };
