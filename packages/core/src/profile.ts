import { z } from "zod";
import { secretKeySchema, sessionIdSchema, type SecretKey } from "./ids.ts";
import { llmAuthKindSchema, llmProviderSchema, supportedLlmAuthKinds } from "./llm-auth.ts";
import type { SecretBinding, SecretInjection } from "./secrets.ts";

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

export type StarterCategory = "cli" | "harness" | "integration";

export type StarterConfigFieldKind = "string" | "host-port" | "url";

export interface StarterConfigField {
  readonly key: string;
  readonly kind: StarterConfigFieldKind;
  readonly prompt: string;
  readonly placeholder: string;
}

export type StarterSecret =
  | {
      readonly kind: "fixed";
      readonly key: SecretKey;
      readonly binding: SecretBinding;
    }
  | {
      readonly kind: "prompt-domain";
      readonly key: SecretKey;
      readonly inject: SecretInjection;
      readonly domainPrompt: string;
      readonly domainPlaceholder: string;
      readonly fromConfigUrl?: { readonly starterId: string; readonly key: string };
    };

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

export const profileConfigSchema = z.object({
  name: z.string().min(1),
  model: modelRefSchema,
  starters: z.array(z.string().min(1)).default([]),
  starterConfig: starterConfigSchema.default({}),
});
export type ProfileConfig = z.infer<typeof profileConfigSchema>;

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
