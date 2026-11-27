import { parseArgs } from "node:util";
import { modelRefSchema, profileIdSchema, starterConfigFlagsSchema } from "@tetherbox/core";
import type { DaemonConfig } from "../config.ts";
import { signalDaemonReload } from "../pid.ts";
import { createProfileOnDisk, updateProfileOnDisk } from "../profiles/files.ts";
import { ProfileRegistry } from "../profiles/registry.ts";
import { StarterCatalog } from "../profiles/starter-catalog.ts";

const MODEL_ARG_OPTIONS = {
  provider: { type: "string" },
  model: { type: "string" },
  auth: { type: "string" },
} as const;

interface ModelArgs {
  provider?: string | undefined;
  model?: string | undefined;
  auth?: string | undefined;
}

function modelInput(values: ModelArgs) {
  return {
    provider: values.provider,
    id: values.model,
    auth: values.auth,
  };
}

async function reportReload(config: DaemonConfig, message: string): Promise<void> {
  const reloaded = await signalDaemonReload(config.dataDir);

  console.log(reloaded ? `${message} (reloaded daemon)` : message);
}

export async function runProfilesCommand(config: DaemonConfig, args: string[]): Promise<void> {
  const [action, rawId, ...rest] = args;
  const registry = new ProfileRegistry(config.profilesDir);

  switch (action) {
    case "list": {
      for (const issue of await registry.loadAll()) {
        console.warn(`${issue.file}: ${issue.message}`);
      }

      for (const profile of registry.all()) {
        console.log(`${profile.id}\t${profile.config.name}`);
      }

      return;
    }
    case "validate": {
      const load = await registry.reload(profileIdSchema.parse(rawId));

      for (const issue of load.issues) {
        console.log(`${issue.file}: ${issue.message}`);
      }

      process.exitCode = load.kind === "loaded" && load.issues.length === 0 ? 0 : 1;

      return;
    }
    case "create": {
      const id = profileIdSchema.parse(rawId);
      const { values } = parseArgs({
        args: rest,
        options: {
          name: { type: "string" },
          ...MODEL_ARG_OPTIONS,
          starter: { type: "string", multiple: true, default: [] },
          "starter-config": { type: "string", multiple: true, default: [] },
        },
      });
      const starterConfig = starterConfigFlagsSchema.parse(values["starter-config"]);
      const model = modelRefSchema.parse(modelInput(values));

      await createProfileOnDisk({
        profilesDir: config.profilesDir,
        catalog: await StarterCatalog.open(config.dataDir),
        input: { id, name: values.name ?? id, model, starters: values.starter, starterConfig },
      });

      // TODO: Set profileDir ownership to config.agent.user once the VM installer configures a
      // shared group or chown rule for the daemon user.
      await reportReload(config, `created ${id}`);

      return;
    }
    case "set-model": {
      const id = profileIdSchema.parse(rawId);
      const { values } = parseArgs({
        args: rest,
        options: MODEL_ARG_OPTIONS,
      });
      const model = modelRefSchema.parse(modelInput(values));

      await updateProfileOnDisk({
        profilesDir: config.profilesDir,
        catalog: await StarterCatalog.open(config.dataDir),
        id,
        input: { model },
      });
      await reportReload(
        config,
        `set ${id} model to ${model.provider}/${model.id} (${model.auth})`,
      );

      return;
    }
    case "reload": {
      const reloaded = await signalDaemonReload(config.dataDir);

      if (!reloaded) {
        throw new Error("daemon is not running");
      }

      console.log("reloaded daemon");

      return;
    }
    default:
      throw new Error(
        "usage: tetherbox-daemon profiles <list|validate|create|set-model|reload> [id]",
      );
  }
}
