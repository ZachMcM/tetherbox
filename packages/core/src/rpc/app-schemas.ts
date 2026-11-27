import { z } from "zod";
import { profileIdSchema, type EntryName, type ProfileId } from "../ids.ts";
import type { LlmAuthKind, LlmProvider } from "../llm-auth.ts";
import {
  oauthScopeModeSchema,
  type OAuthPreset,
  type OAuthPresetId,
  type OAuthProviderConfig,
} from "../oauth.ts";
import type { RegisteredPollJob } from "../poll.ts";
import {
  modelSelectionSchema,
  profileConfigSchema,
  type ModelEffort,
  starterConfigSchema,
  type CronJob,
  type ProfileConfig,
  type ProfileIssue,
  type StarterCategory,
  type StarterConfigField,
  type StarterSecret,
  type Webhook,
} from "../profile.ts";
import type { ScheduledReminder } from "../reminder.ts";
import { secretBindingSchema } from "../secrets.ts";

export const createProfileInputSchema = profileConfigSchema.extend({
  id: profileIdSchema,
  name: z.string().trim().min(1),
});
export type CreateProfileInput = z.infer<typeof createProfileInputSchema>;

export const updateProfileInputSchema = z.object({
  name: z.string().trim().min(1).optional(),
  model: modelSelectionSchema.nullable().optional(),
  starters: z.array(z.string().min(1)).optional(),
  starterConfig: starterConfigSchema.optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>;

export const updateMemoryInputSchema = z.object({
  content: z.string(),
});
export type UpdateMemoryInput = z.infer<typeof updateMemoryInputSchema>;

export const createSessionInputSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  prompt: z.string().trim().min(1).optional(),
  model: modelSelectionSchema.optional(),
});
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;

export const sendSessionMessageInputSchema = z.object({
  text: z.string().trim().min(1),
  model: modelSelectionSchema.optional(),
});
export type SendSessionMessageInput = z.infer<typeof sendSessionMessageInputSchema>;

export const updateSessionInputSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  markRead: z.boolean().optional(),
  model: modelSelectionSchema.nullable().optional(),
});
export type UpdateSessionInput = z.infer<typeof updateSessionInputSchema>;

export const appSettingsSchema = z.object({
  defaultModel: modelSelectionSchema.nullable(),
  onboardingCompleted: z.boolean(),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const updateAppSettingsInputSchema = z.object({
  defaultModel: modelSelectionSchema.nullable().optional(),
  onboardingCompleted: z.boolean().optional(),
});
export type UpdateAppSettingsInput = z.infer<typeof updateAppSettingsInputSchema>;

export const setSecretInputSchema = z.object({
  value: z.string().trim().min(1),
  binding: secretBindingSchema,
});
export type SetSecretInput = z.infer<typeof setSecretInputSchema>;

export const startPresetOAuthInputSchema = z.object({
  scopeMode: oauthScopeModeSchema.optional(),
});
export type StartPresetOAuthInput = z.infer<typeof startPresetOAuthInputSchema>;

export const deletePushSubscriptionInputSchema = z.object({
  endpoint: z.url(),
});
export type DeletePushSubscriptionInput = z.infer<typeof deletePushSubscriptionInputSchema>;

export const llmOAuthRespondInputSchema = z.object({
  value: z.string(),
});
export type LlmOAuthRespondInput = z.infer<typeof llmOAuthRespondInputSchema>;

export const cliAuthRespondInputSchema = z.object({
  value: z.string(),
});
export type CliAuthRespondInput = z.infer<typeof cliAuthRespondInputSchema>;

export interface ProfileCronSummary {
  name: EntryName;
  job: CronJob;
}

export interface ProfileWebhookSummary {
  name: EntryName;
  webhook: Webhook;
}

export interface ProfileSummary {
  id: ProfileId;
  config: ProfileConfig;
  cronCount: number;
  webhookCount: number;
  pollJobCount: number;
  reminderCount: number;
}

export interface ProfileDetail {
  id: ProfileId;
  config: ProfileConfig;
  memory: string;
  cron: ProfileCronSummary[];
  webhooks: ProfileWebhookSummary[];
  pollJobs: RegisteredPollJob[];
  reminders: ScheduledReminder[];
  issues: ProfileIssue[];
}

export interface StarterSummary {
  id: string;
  name: string;
  kind: "skill" | "module";
  category: StarterCategory;
  configFields: readonly StarterConfigField[];
  secrets: readonly StarterSecret[];
  oauthPreset?: OAuthPresetId;
  cli?: {
    binary: string;
    hasAuth: boolean;
  };
  setupNote?: string;
}

export type StarterCliStatus =
  | { kind: "missing" }
  | {
      kind: "installed";
      auth: "none" | "authenticated" | "unauthenticated" | "unknown";
    }
  | { kind: "error"; message: string };

export interface StarterCliStatusEntry {
  starterId: string;
  name: string;
  binary: string;
  hasInstall: boolean;
  installDescription?: string;
  hasAuth: boolean;
  status: StarterCliStatus;
}

export interface LlmProviderStatus {
  provider: LlmProvider;
  supportedAuth: readonly LlmAuthKind[];
  hasApiKey: boolean;
  oauthLabel?: string;
  oauthExpires?: string;
}

export interface ModelEffortOption {
  level: ModelEffort;
  label: string;
}

export interface LlmModelOption {
  provider: LlmProvider;
  auth: LlmAuthKind;
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  effortOptions: ModelEffortOption[];
  favorite: boolean;
}

export type OAuthPresetSummary = Pick<
  OAuthPreset,
  "id" | "provider" | "label" | "secretKey" | "domains" | "defaultScopeMode"
> &
  Pick<OAuthProviderConfig, "clientIdSecretKey" | "clientSecretSecretKey"> & {
    hasClientCredentials: boolean;
  };

export type LlmOAuthFlowEvent =
  | { kind: "auth_url"; url: string; instructions?: string }
  | { kind: "device_code"; verificationUri: string; userCode: string }
  | { kind: "info"; message: string; links?: { label?: string; url: string }[] }
  | { kind: "progress"; message: string };

export type LlmOAuthFlowPrompt =
  | {
      kind: "text";
      message: string;
      placeholder?: string;
    }
  | {
      kind: "select";
      message: string;
      options: { id: string; label: string; description?: string }[];
    };

interface LlmOAuthFlowBase {
  id: string;
  provider: LlmProvider;
  events: LlmOAuthFlowEvent[];
}

export type LlmOAuthFlowState =
  | (LlmOAuthFlowBase & { status: "pending" | "completed"; prompt: null; error: null })
  | (LlmOAuthFlowBase & { status: "waiting_input"; prompt: LlmOAuthFlowPrompt; error: null })
  | (LlmOAuthFlowBase & { status: "failed" | "cancelled"; prompt: null; error: string });
