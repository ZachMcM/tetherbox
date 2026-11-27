import { z } from "zod";
import { secretKeySchema } from "./ids.ts";
import { oauthPresetSchema } from "./oauth.ts";
import { proxySecretBindingSchema } from "./secrets.ts";
import { starterIdSchema } from "./starter.ts";

export const REQUEST_AUTH_TOOL_NAME = "request_auth";

const requestableSecretBindingSchema = z.discriminatedUnion("kind", [
  proxySecretBindingSchema,
  z.object({ kind: z.literal("daemon") }),
]);

export const authRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("value"),
    key: secretKeySchema,
    binding: requestableSecretBindingSchema,
  }),
  z.object({ kind: z.literal("oauth"), preset: oauthPresetSchema }),
  z.object({ kind: z.literal("cli-login"), starter: starterIdSchema }),
]);
export type AuthRequest = z.infer<typeof authRequestSchema>;

export const requestAuthArgsSchema = z.object({
  reason: z.string().min(1).max(500),
  request: authRequestSchema,
});
export type RequestAuthArgs = z.infer<typeof requestAuthArgsSchema>;
