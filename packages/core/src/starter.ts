import { z } from "zod";
import { secretKeySchema } from "./ids.ts";
import { oauthPresetSchema } from "./oauth.ts";
import { profileLayout } from "./paths.ts";
import { proxySecretBindingSchema, secretInjectionSchema } from "./secrets.ts";

export const starterIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "use a lowercase slug of letters, digits, and hyphens");

export const starterCategorySchema = z.enum(["cli", "harness", "integration"]);
export type StarterCategory = z.infer<typeof starterCategorySchema>;

export const starterConfigFieldKindSchema = z.enum(["string", "host-port", "url"]);
export type StarterConfigFieldKind = z.infer<typeof starterConfigFieldKindSchema>;

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

export const starterConfigFieldSchema = z.object({
  key: z.string().regex(/^[A-Za-z0-9_-]+$/),
  kind: starterConfigFieldKindSchema,
  prompt: z.string().min(1),
  placeholder: z.string().min(1),
});
export type StarterConfigField = z.infer<typeof starterConfigFieldSchema>;

export const starterSecretSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("fixed"),
    key: secretKeySchema,
    binding: proxySecretBindingSchema,
  }),
  z.object({
    kind: z.literal("prompt-domain"),
    key: secretKeySchema,
    inject: secretInjectionSchema,
    domainPrompt: z.string().min(1),
    domainPlaceholder: z.string().min(1),
    fromConfigUrl: z.object({ starterId: starterIdSchema, key: z.string().min(1) }).optional(),
  }),
]);
export type StarterSecret = z.infer<typeof starterSecretSchema>;

const commandSchema = z.tuple([z.string().min(1)], z.string());

export const starterConnectionCheckSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("command"),
    command: commandSchema,
  }),
  z.object({
    kind: z.literal("http"),
    urlField: z.string().min(1),
    path: z.string().startsWith("/").optional(),
  }),
]);
export type StarterConnectionCheck = z.infer<typeof starterConnectionCheckSchema>;

export const CONFIG_PLACEHOLDER_PATTERN = /\{\{([A-Za-z0-9_-]+)\}\}/g;

export const starterCliSchema = z.object({
  binary: z.string().regex(/^[A-Za-z0-9._-]+$/),
  install: z
    .object({
      description: z.string().min(1),
      command: commandSchema,
    })
    .optional(),
  auth: z
    .object({
      checkCommand: commandSchema.optional(),
      loginCommand: commandSchema,
    })
    .optional(),
});
export type StarterCli = z.infer<typeof starterCliSchema>;
export type StarterCliInstall = NonNullable<StarterCli["install"]>;
export type StarterCliAuth = NonNullable<StarterCli["auth"]>;

export const starterKindSchema = z.enum(["skill", "module"]);
export type StarterKind = z.infer<typeof starterKindSchema>;

export const starterSchema = z
  .strictObject({
    id: starterIdSchema,
    kind: starterKindSchema,
    name: z.string().min(1),
    category: starterCategorySchema,
    secrets: z.array(starterSecretSchema).default([]),
    oauthPreset: oauthPresetSchema.optional(),
    cli: starterCliSchema.optional(),
    configFields: z.array(starterConfigFieldSchema).default([]),
    connectionCheck: starterConnectionCheckSchema.optional(),
    setupNote: z.string().min(1).optional(),
  })
  .superRefine((starter, ctx) => {
    const configKeys = new Set(starter.configFields.map((field) => field.key));

    for (const [index, secret] of starter.secrets.entries()) {
      if (secret.kind !== "prompt-domain" || secret.fromConfigUrl === undefined) {
        continue;
      }

      if (
        secret.fromConfigUrl.starterId !== starter.id ||
        !configKeys.has(secret.fromConfigUrl.key)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["secrets", index, "fromConfigUrl"],
          message: "must name one of this starter's config fields",
        });
      }
    }

    const check = starter.connectionCheck;

    if (check !== undefined) {
      if (check.kind === "http") {
        const urlField = starter.configFields.find((field) => field.key === check.urlField);

        if (urlField === undefined || urlField.kind !== "url") {
          ctx.addIssue({
            code: "custom",
            path: ["connectionCheck", "urlField"],
            message: 'must name one of this starter\'s "url" config fields',
          });
        }
      } else {
        for (const [index, arg] of check.command.entries()) {
          for (const match of arg.matchAll(CONFIG_PLACEHOLDER_PATTERN)) {
            const key = match[1];

            if (key !== undefined && !configKeys.has(key)) {
              ctx.addIssue({
                code: "custom",
                path: ["connectionCheck", "command", index],
                message: `placeholder "{{${key}}}" must name one of this starter's config fields`,
              });
            }
          }
        }
      }
    }
  });
export type StarterInput = z.input<typeof starterSchema>;
export type Starter = z.infer<typeof starterSchema>;

export type StarterSource = "builtin" | "library";

export function starterFromManifestSchema(id: string, kind: StarterKind) {
  return z.preprocess((manifest, ctx) => {
    if (typeof manifest !== "object" || manifest === null) {
      return manifest;
    }

    if ("id" in manifest || "kind" in manifest) {
      ctx.issues.push({
        code: "custom",
        message: "remove id and kind; they come from the directory path",
        input: manifest,
      });
    }

    return { ...manifest, id, kind };
  }, starterSchema);
}

export const starterKindDirs = {
  skill: profileLayout.skillsDir,
  module: profileLayout.modulesDir,
} as const satisfies Record<StarterKind, string>;

export function starterPath(starter: Pick<Starter, "id" | "kind">) {
  return `${starterKindDirs[starter.kind]}/${starter.id}` as const;
}
