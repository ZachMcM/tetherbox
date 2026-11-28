import { z } from "zod";
import { secretKeySchema } from "./ids.ts";
import { llmProviderSchema } from "./llm-auth.ts";

export const hostnameSchema = z
  .string()
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);

const headerNameSchema = z.string().regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/);
const queryNameSchema = z.string().regex(/^[!-~]+$/);

export const secretInjectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bearer") }),
  z.object({ kind: z.literal("header"), name: headerNameSchema }),
  z.object({ kind: z.literal("query"), name: queryNameSchema }),
]);
export type SecretInjection = z.infer<typeof secretInjectionSchema>;

export const proxySecretBindingSchema = z.object({
  kind: z.literal("proxy"),
  domains: z.array(hostnameSchema).nonempty(),
  inject: secretInjectionSchema,
});

export const secretBindingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daemon") }),
  proxySecretBindingSchema,
  z.object({
    kind: z.literal("llm"),
    provider: llmProviderSchema,
  }),
]);
export type SecretBinding = z.infer<typeof secretBindingSchema>;
export type SecretKind = SecretBinding["kind"];

export const secretListEntrySchema = z.object({
  key: secretKeySchema,
  binding: secretBindingSchema,
});
export const secretListSchema = z.array(secretListEntrySchema);
export type SecretListEntry = z.infer<typeof secretListEntrySchema>;

export type SecretCheckKind = SecretKind | "oauth";
export type SecretCheckResult = { exists: false } | { exists: true; kind: SecretCheckKind };

export function formatSecretInjection(inject: SecretInjection): string {
  switch (inject.kind) {
    case "bearer":
      return "bearer";
    case "header":
    case "query":
      return `${inject.kind}:${inject.name}`;
    default: {
      const exhaustive: never = inject;

      return exhaustive;
    }
  }
}
