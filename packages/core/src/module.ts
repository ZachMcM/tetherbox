import type { ProfileId } from "./ids.ts";

export interface JsonSchemaObject {
  type: "object";
  properties: Record<string, unknown>;
  required?: readonly string[];
  additionalProperties?: boolean;
}

export type ModuleToolResult = { kind: "text"; text: string } | { kind: "json"; value: unknown };

export interface ModuleContext {
  profileId: ProfileId;
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
