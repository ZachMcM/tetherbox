import { z } from "zod";
import { entryNameSchema, secretKeySchema, type EntryName } from "./ids.ts";
import { llmAuthKindSchema, llmProviderSchema, supportedLlmAuthKinds } from "./llm-auth.ts";

export const modelRefSchema = z
  .object({
    provider: llmProviderSchema,
    id: z.string().min(1),
    auth: llmAuthKindSchema.default("api-key"),
  })
  .refine((model) => supportedLlmAuthKinds(model.provider).includes(model.auth), {
    message: "this provider does not support that auth kind",
    path: ["auth"],
  });
export type ModelRef = z.infer<typeof modelRefSchema>;

export const starterConfigSchema = z.record(
  z.string().min(1),
  z.record(z.string().min(1), z.string().min(1)),
);
export type StarterConfig = z.infer<typeof starterConfigSchema>;

export type StarterConfigFieldKind = "string" | "host-port" | "url";

export const starterConfigFieldSchemas: Readonly<
  Record<StarterConfigFieldKind, z.ZodType<string>>
> = {
  string: z.string().trim().min(1, "A value is required"),
  "host-port": z
    .string()
    .trim()
    .min(1, "A host or host:port is required")
    .refine((value) => {
      if (/[/?#@\\]/.test(value)) {
        return false;
      }

      const parsed = URL.parse(`http://${value}`);

      return parsed !== null && parsed.hostname !== "" && parsed.pathname === "/";
    }, "Enter a valid host or host:port (for example workstation.tailnet.ts.net:6767)"),
  url: z
    .string()
    .trim()
    .pipe(z.url({ protocol: /^https?$/, error: "Enter a valid http:// or https:// URL" })),
};

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

export const slackChannelIdSchema = z.string().regex(/^[CDG][A-Z0-9]+$/);
export const slackTsSchema = z.string().regex(/^\d+\.\d+$/);

export const profileChannelsSchema = z.record(entryNameSchema, slackChannelIdSchema);
export type ProfileChannels = z.infer<typeof profileChannelsSchema>;

export const profileConfigSchema = z
  .object({
    name: z.string().min(1),
    slackChannelId: slackChannelIdSchema,
    channels: profileChannelsSchema.default({}),
    model: modelRefSchema,
    starters: z.array(z.string().min(1)).default([]),
    starterConfig: starterConfigSchema.default({}),
  })
  .superRefine((config, ctx) => {
    const seen = new Map<string, string>([[config.slackChannelId, "slackChannelId"]]);

    for (const [name, channelId] of Object.entries(config.channels)) {
      const existing = seen.get(channelId);

      if (existing !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["channels", name],
          message: `Slack channel ${channelId} is already assigned to ${existing}`,
        });
        continue;
      }

      seen.set(channelId, `channels.${name}`);
    }
  });
export type ProfileConfig = z.infer<typeof profileConfigSchema>;

export function profileChannelIds(config: ProfileConfig): string[] {
  return [config.slackChannelId, ...Object.values(config.channels)];
}

export function resolveProfileChannel(
  config: ProfileConfig,
  channelName: EntryName | undefined,
): string | undefined {
  if (channelName === undefined) {
    return config.slackChannelId;
  }

  return Object.hasOwn(config.channels, channelName) ? config.channels[channelName] : undefined;
}

export function profileChannelName(config: ProfileConfig, channelId: string): string | undefined {
  for (const [name, id] of Object.entries(config.channels)) {
    if (id === channelId) {
      return name;
    }
  }

  return undefined;
}

export const cronJobSchema = z.object({
  schedule: z.string().min(1),
  timezone: z.string().min(1).optional(),
  channel: entryNameSchema.optional(),
  threadTs: slackTsSchema.optional(),
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
  channel: entryNameSchema.optional(),
  prompt: z.string().min(1),
  verify: webhookVerificationSchema,
});
export type Webhook = z.infer<typeof webhookSchema>;

export interface ProfileIssue {
  file: string;
  message: string;
}

export type ProfileValidation = { ok: true } | { ok: false; issues: ProfileIssue[] };
