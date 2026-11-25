import { execFile } from "node:child_process";
import { access, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { text } from "node:stream/consumers";
import { parseArgs, promisify } from "node:util";
import {
  formatSecretInjection,
  llmProviderSchema,
  profileConfigSchema,
  profileIdSchema,
  profileLayout,
  resolveSecretBinding,
  secretKeySchema,
  type SecretBinding,
} from "@tetherbox/core";
import { resolveStarters, templatesDir } from "@tetherbox/starters";
import type { DaemonConfig } from "./config.ts";
import { signalDaemonReload } from "./pid.ts";
import { ProfileRegistry } from "./profiles.ts";
import type { SecretStore } from "./secret-store.ts";

const execFileAsync = promisify(execFile);

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);

    return true;
  } catch {
    return false;
  }
}

function formatBinding(binding: SecretBinding): string {
  switch (binding.kind) {
    case "daemon":
      return "daemon";
    case "llm":
      return `llm\t${binding.provider}`;
    case "proxy":
      return `proxy\t${binding.domains.join(",")}\t${formatSecretInjection(binding.inject)}`;
    default: {
      const exhaustive: never = binding;

      return exhaustive;
    }
  }
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
          inject: { type: "string" },
          provider: { type: "string" },
        },
      });
      const key = secretKeySchema.parse(rawKey);
      const binding = resolveSecretBinding({
        domains: values.domain,
        inject: values.inject,
        provider: values.provider,
      });
      const value = (await text(process.stdin)).trim();

      if (value === "") {
        throw new Error("expected the secret value on stdin");
      }

      await store.set(key, { value, binding });
      console.log(`stored ${key} (${binding.kind})`);

      return;
    }
    case "has":
      console.log((await store.has(secretKeySchema.parse(rawKey))) ? "yes" : "no");

      return;
    case "delete":
      await store.delete(secretKeySchema.parse(rawKey));

      return;
    case "list":
      for (const entry of await store.list()) {
        console.log(`${entry.key}\t${formatBinding(entry.binding)}`);
      }

      return;
    default:
      throw new Error("usage: tetherbox-daemon secrets <set|has|delete|list> [key]");
  }
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
    case "create": {
      const id = profileIdSchema.parse(rawId);
      const { values } = parseArgs({
        args: rest,
        options: {
          name: { type: "string" },
          channel: { type: "string" },
          provider: { type: "string" },
          model: { type: "string" },
          starter: { type: "string", multiple: true, default: [] },
        },
      });
      const selectedStarters = resolveStarters(values.starter);
      const profileConfig = profileConfigSchema.parse({
        name: values.name ?? id,
        slackChannelId: values.channel,
        model: {
          provider: llmProviderSchema.parse(values.provider),
          id: values.model,
        },
        starters: selectedStarters.map((starter) => starter.id),
      });
      const profileDir = join(config.profilesDir, id);

      if (await pathExists(profileDir)) {
        throw new Error(`profile "${id}" already exists at ${profileDir}`);
      }

      await registry.loadAll();

      const channelOwner = registry.byChannel(profileConfig.slackChannelId);

      if (channelOwner !== undefined) {
        throw new Error(
          `Slack channel ${profileConfig.slackChannelId} already belongs to profile ${channelOwner.id}`,
        );
      }

      await mkdir(profileDir, { recursive: true });

      try {
        await writeFile(
          join(profileDir, profileLayout.config),
          `${JSON.stringify(profileConfig, null, 2)}\n`,
        );
        await writeFile(join(profileDir, profileLayout.memory), `# ${profileConfig.name}\n`);

        for (const starter of selectedStarters) {
          await cp(join(templatesDir, starter.path), join(profileDir, starter.path), {
            recursive: true,
          });
        }

        await execFileAsync("git", ["init", "-q"], { cwd: profileDir });
      } catch (error) {
        await rm(profileDir, { recursive: true, force: true });
        throw error;
      }

      // TODO: Set profileDir ownership to config.agent.user once the VM installer configures a
      // shared group or chown rule for the daemon user.
      const reloaded = await signalDaemonReload(config.dataDir);

      console.log(reloaded ? `created ${id} (reloaded daemon)` : `created ${id}`);

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
      throw new Error("usage: tetherbox-daemon profiles <list|validate|create|reload> [id]");
  }
}
