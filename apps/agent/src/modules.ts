import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  profileLayout,
  type ModuleContext,
  type ModuleToolResult,
  type TetherboxModule,
} from "@tetherbox/core";
import type { TSchema } from "typebox";

function toText(result: ModuleToolResult): string {
  return result.kind === "text" ? result.text : JSON.stringify(result.value, null, 2);
}

function adaptModule(module: TetherboxModule, ctx: ModuleContext): ToolDefinition[] {
  return module.tools.map((tool) => ({
    name: `${module.name}_${tool.name}`,
    label: `${module.name}: ${tool.name}`,
    description: tool.description,
    parameters: tool.parameters as unknown as TSchema,
    async execute(_toolCallId, params) {
      const result = await tool.execute(params, ctx);

      return { content: [{ type: "text", text: toText(result) }], details: {} };
    },
  }));
}

/**
 * Imports `modules/<name>/index.ts` from the profile with Node's built-in type stripping.
 */
export async function loadProfileModules(
  profileDir: string,
  ctx: ModuleContext,
): Promise<ToolDefinition[]> {
  const modulesDir = join(profileDir, profileLayout.modulesDir);
  let names: string[];

  try {
    names = (await readdir(modulesDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const tools: ToolDefinition[] = [];

  for (const name of names) {
    const entry = pathToFileURL(join(modulesDir, name, profileLayout.moduleEntry)).href;

    try {
      const loaded = (await import(entry)) as { default: TetherboxModule };

      // TODO: Validate the default export's shape and report requiredSecrets that are missing.
      tools.push(...adaptModule(loaded.default, ctx));
    } catch (error) {
      // TODO: Surface module load errors to the agent so it can fix modules it wrote.
      console.error(`failed to load module ${name}`, error);
    }
  }

  return tools;
}
