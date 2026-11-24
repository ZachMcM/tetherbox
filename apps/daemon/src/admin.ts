import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";
import {
  profileIdSchema,
  secretBindingSchema,
  secretKeySchema,
  type SecretInjection,
} from "@tetherbox/core";
import type { DaemonConfig } from "./config.ts";
import { ProfileRegistry } from "./profiles.ts";
import type { SecretStore } from "./secret-store.ts";

function parseInjection(spec: string): SecretInjection {
  const [kind, name] = spec.split(":", 2);

  if (kind === "bearer" && name === undefined) {
    return { kind: "bearer" };
  }

  if ((kind === "header" || kind === "query") && name !== undefined && name !== "") {
    return { kind, name };
  }

  throw new Error(`invalid --inject "${spec}", expected bearer, header:<name>, or query:<name>`);
}

/**
 * Commands run on the VM as the daemon's OS user, usually through `tetherbox` over SSH. Secret
 * values arrive on stdin so they never show up in process arguments or shell history.
 */
export async function runSecretsCommand(store: SecretStore, args: string[]): Promise<void> {
  const [action, rawKey, ...rest] = args;

  switch (action) {
    case "set": {
      const { values } = parseArgs({
        args: rest,
        options: {
          domain: { type: "string", multiple: true, default: [] },
          inject: { type: "string", default: "bearer" },
        },
      });
      const key = secretKeySchema.parse(rawKey);
      const binding = secretBindingSchema.parse({
        domains: values.domain,
        inject: parseInjection(values.inject),
      });
      const value = (await text(process.stdin)).trim();

      if (value === "") {
        throw new Error("expected the secret value on stdin");
      }

      await store.set(key, { value, binding });
      console.log(`stored ${key}`);

      return;
    }
    case "has":
      console.log((await store.has(secretKeySchema.parse(rawKey))) ? "yes" : "no");

      return;
    case "delete":
      await store.delete(secretKeySchema.parse(rawKey));

      return;
    case "list":
      for (const key of await store.list()) {
        console.log(key);
      }

      return;
    default:
      throw new Error("usage: tetherbox-daemon secrets <set|has|delete|list> [key]");
  }
}

export async function runProfilesCommand(config: DaemonConfig, args: string[]): Promise<void> {
  const [action, rawId] = args;
  const registry = new ProfileRegistry(config.profilesDir);

  switch (action) {
    case "list": {
      for (const issue of await registry.loadAll()) {
        console.warn(`${issue.file}: ${issue.message}`);
      }

      for (const profile of registry.all()) {
        console.log(`${profile.id}\t${profile.config.slackChannelId}\t${profile.config.name}`);
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
    case "create":
      // TODO: Create <profilesDir>/<id> owned by the agent user, write profile.json and MEMORY.md,
      // copy the selected starters from @tetherbox/starters' templatesDir, and `git init` it.
      throw new Error("profiles create is not implemented");
    default:
      throw new Error("usage: tetherbox-daemon profiles <list|validate|create> [id]");
  }
}
