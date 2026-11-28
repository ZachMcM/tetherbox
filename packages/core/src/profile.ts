import { z } from "zod";
import { secretKeySchema, sessionIdSchema } from "./ids.ts";
import { llmAuthKindSchema, llmProviderSchema, supportedLlmAuthKinds } from "./llm-auth.ts";

export const modelEffortSchema = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export type ModelEffort = z.infer<typeof modelEffortSchema>;

const modelRefObjectSchema = z.object({
  provider: llmProviderSchema,
  id: z.string().min(1),
  auth: llmAuthKindSchema.default("api-key"),
});

function requireSupportedAuth<T extends z.ZodType<z.infer<typeof modelRefObjectSchema>>>(
  schema: T,
) {
  return schema.refine((model) => supportedLlmAuthKinds(model.provider).includes(model.auth), {
    message: "this provider does not support that auth kind",
    path: ["auth"],
  });
}

export const modelRefSchema = requireSupportedAuth(modelRefObjectSchema);
export type ModelRef = z.infer<typeof modelRefSchema>;

export const modelSelectionSchema = requireSupportedAuth(
  modelRefObjectSchema.extend({ effort: modelEffortSchema.optional() }),
);
export type ModelSelection = z.infer<typeof modelSelectionSchema>;

export const starterConfigSchema = z.record(
  z.string().min(1),
  z.record(z.string().min(1), z.string().min(1)),
);
export type StarterConfig = z.infer<typeof starterConfigSchema>;

const STARTER_CONFIG_FLAG_PATTERN = /^([a-z0-9-]+)\.([A-Za-z0-9_-]+)=(.+)$/;

export const starterConfigFlagSchema = z
  .string()
  .regex(STARTER_CONFIG_FLAG_PATTERN, "invalid --starter-config, expected <starter>.<key>=<value>")
  .transform((entry) => {
    const [, starterId = "", key = "", value = ""] = STARTER_CONFIG_FLAG_PATTERN.exec(entry) ?? [];

    return { starterId, key, value };
  });

export const starterConfigFlagsSchema = z
  .array(starterConfigFlagSchema)
  .transform((entries) => {
    const config: Record<string, Record<string, string>> = {};

    for (const { starterId, key, value } of entries) {
      config[starterId] ??= {};
      config[starterId][key] = value;
    }

    return config;
  })
  .pipe(starterConfigSchema);

export const profileConfigSchema = z.object({
  starters: z.array(z.string().min(1)).default([]),
  starterConfig: starterConfigSchema.default({}),
});
export type ProfileConfig = z.infer<typeof profileConfigSchema>;

const BUDDY_SHAPES = ["circle", "squircle", "triangle"] as const;
const BUDDY_COLORS = ["coral", "amber", "lime", "mint", "sky", "iris", "rose", "stone"] as const;
const BUDDY_GAZES = ["ahead", "left", "right", "up", "up-right", "down"] as const;

export const buddyShapeSchema = z.enum(BUDDY_SHAPES);

export const buddyColorSchema = z.enum(BUDDY_COLORS);

export const buddyGazeSchema = z.enum(BUDDY_GAZES);
export type BuddyGaze = z.infer<typeof buddyGazeSchema>;

export const buddySchema = z.object({
  shape: buddyShapeSchema,
  color: buddyColorSchema,
  gaze: buddyGazeSchema,
});
export type Buddy = z.infer<typeof buddySchema>;

export function defaultBuddy(profileId: string): Buddy {
  let hash = 7;

  for (const char of profileId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  const pick = <T>(options: readonly [T, ...T[]], salt: number): T =>
    options[(hash >>> salt) % options.length] ?? options[0];

  return {
    shape: pick(BUDDY_SHAPES, 0),
    color: pick(BUDDY_COLORS, 3),
    gaze: pick(BUDDY_GAZES, 7),
  };
}

export const cronJobSchema = z.object({
  schedule: z.string().min(1),
  timezone: z.string().min(1).optional(),
  sessionId: sessionIdSchema.optional(),
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
