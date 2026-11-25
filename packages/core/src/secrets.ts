import { z } from "zod";
import { llmProviderSchema } from "./ids.ts";

const hostnameSchema = z
  .string()
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);

export const secretInjectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bearer") }),
  z.object({ kind: z.literal("header"), name: z.string().min(1) }),
  z.object({ kind: z.literal("query"), name: z.string().min(1) }),
]);
export type SecretInjection = z.infer<typeof secretInjectionSchema>;

export const secretBindingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daemon") }),
  z.object({
    kind: z.literal("proxy"),
    domains: z.array(hostnameSchema).nonempty(),
    inject: secretInjectionSchema,
  }),
  z.object({
    kind: z.literal("llm"),
    provider: llmProviderSchema,
  }),
]);
export type SecretBinding = z.infer<typeof secretBindingSchema>;
export type SecretKind = SecretBinding["kind"];

export type SecretCheckResult = { exists: false } | { exists: true; kind: SecretKind };

export function parseSecretInjection(spec: string): SecretInjection {
  const [kind, name] = spec.split(":", 2);

  if (kind === "bearer" && name === undefined) {
    return { kind: "bearer" };
  }

  if ((kind === "header" || kind === "query") && name !== undefined && name !== "") {
    return { kind, name };
  }

  throw new Error(`invalid --inject "${spec}", expected bearer, header:<name>, or query:<name>`);
}

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

export interface SecretBindingOptions {
  domains?: readonly string[] | undefined;
  inject?: string | undefined;
  provider?: string | undefined;
}

export function resolveSecretBinding(options: SecretBindingOptions): SecretBinding {
  const domains = options.domains ?? [];
  const hasDomains = domains.length > 0;
  const hasProvider = options.provider !== undefined;

  if (hasDomains && hasProvider) {
    throw new Error("cannot combine --domain and --provider");
  }

  if (!hasDomains && options.inject !== undefined) {
    throw new Error("--inject can only be used with --domain");
  }

  if (hasProvider) {
    return secretBindingSchema.parse({ kind: "llm", provider: options.provider });
  }

  if (hasDomains) {
    return secretBindingSchema.parse({
      kind: "proxy",
      domains,
      inject: parseSecretInjection(options.inject ?? "bearer"),
    });
  }

  return { kind: "daemon" };
}
