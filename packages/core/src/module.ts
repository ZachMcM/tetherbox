import { z } from "zod";
import { secretKeySchema, type ProfileId } from "./ids.ts";

export const jsonSchemaObjectSchema = z.object({
  type: z.literal("object"),
  properties: z.record(z.string(), z.unknown()),
  required: z.array(z.string()).readonly().optional(),
  additionalProperties: z.boolean().optional(),
});
export type JsonSchemaObject = z.infer<typeof jsonSchemaObjectSchema>;

export const moduleToolResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({ kind: z.literal("json"), value: z.unknown() }),
]);
export type ModuleToolResult = z.infer<typeof moduleToolResultSchema>;

export interface ModuleContext {
  profileId: ProfileId;
  config: Readonly<Record<string, string>>;
  fetchWithSecret(secretKey: string, url: string | URL, init?: RequestInit): Promise<Response>;
  hasSecret(secretKey: string): Promise<boolean>;
}

export interface ModuleTool {
  name: string;
  description: string;
  parameters: JsonSchemaObject;
  execute(params: unknown, ctx: ModuleContext): Promise<ModuleToolResult>;
}

/**
 * Profile modules are loaded from `modules/<name>/index.ts` with Node's type stripping, outside
 * any package, so they may only `import type` from `@tetherbox/core`. Everything they need at
 * runtime comes through `ModuleContext`.
 */
export interface TetherboxModule {
  name: string;
  description: string;
  requiredSecrets: readonly string[];
  tools: readonly ModuleTool[];
}

const moduleToolExecuteSchema = z.custom<ModuleTool["execute"]>(
  (value) => typeof value === "function",
  "tool execute must be a function",
);

export const moduleToolSchema: z.ZodType<ModuleTool> = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  parameters: jsonSchemaObjectSchema,
  execute: moduleToolExecuteSchema,
});

export const tetherboxModuleSchema: z.ZodType<TetherboxModule> = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  requiredSecrets: z.array(secretKeySchema).readonly(),
  tools: z.array(moduleToolSchema).readonly(),
});
