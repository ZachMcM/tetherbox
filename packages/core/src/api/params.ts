import { z } from "zod";
import { entryNameSchema, profileIdSchema, secretKeySchema, sessionIdSchema } from "../ids.ts";
import { llmProviderSchema } from "../llm-auth.ts";
import { oauthPresetSchema } from "../oauth.ts";

export const profileIdParam = z.object({ profileId: profileIdSchema });
export const sessionIdParam = z.object({ sessionId: sessionIdSchema });
export const entryNameParam = z.object({ name: entryNameSchema });
export const profileEntryParam = z.object({ profileId: profileIdSchema, name: entryNameSchema });
export const secretKeyParam = z.object({ key: secretKeySchema });
export const llmProviderParam = z.object({ provider: llmProviderSchema });
export const oauthPresetParam = z.object({ preset: oauthPresetSchema });
export const starterIdParam = z.object({ starterId: z.string().min(1) });
export const profileStarterParam = z.object({
  profileId: profileIdSchema,
  starterId: z.string().min(1),
});
