import { execFile } from "node:child_process";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { text } from "node:stream/consumers";
import { parseArgs, promisify } from "node:util";
import {
  formatSecretInjection,
  getLlmOAuthProvider,
  llmProviderSchema,
  modelRefSchema,
  profileConfigSchema,
  profileIdSchema,
  profileLayout,
  resolveSecretBinding,
  secretKeySchema,
  starterConfigFlagsSchema,
  type ProfileConfig,
  type SecretBinding,
} from "@tetherbox/core";
import { resolveStarters, templatesDir } from "@tetherbox/starters";
import type { DaemonConfig } from "./config.ts";
import type { LlmOAuth } from "./llm-oauth.ts";
import { signalDaemonReload } from "./pid.ts";
import { ProfileRegistry } from "./profiles.ts";
import type { SecretStore } from "./secret-store.ts";
import { withTerminalAuth } from "./terminal-auth.ts";

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
    case "list": {
      const { values } = parseArgs({
        args: args.slice(1),
        options: { json: { type: "boolean", default: false } },
      });
      const entries = await store.list();

      if (values.json) {
        console.log(JSON.stringify(entries));

        return;
      }

      for (const entry of entries) {
        console.log(`${entry.key}\t${formatBinding(entry.binding)}`);
      }

      return;
    }
    default:
      throw new Error("usage: tetherbox-daemon secrets <set|has|delete|list> [key]");
  }
}

function formatExpiry(expires: number): string {
  const date = new Date(expires);

  return Number.isNaN(date.getTime()) ? "never" : date.toISOString();
}

export async function runLlmCommand(llmOAuth: LlmOAuth, args: string[]): Promise<void> {
  const [action, rawProvider] = args;

  switch (action) {
    case "login": {
      const provider = llmProviderSchema.parse(rawProvider);
      const oauthProvider = getLlmOAuthProvider(provider);

      if (oauthProvider === undefined) {
        throw new Error(`provider "${provider}" has no OAuth login`);
      }

      console.log(`Logging in to ${oauthProvider.label}...`);

      const login = await withTerminalAuth((interaction) => llmOAuth.login(provider, interaction));

      console.log(`stored ${provider} OAuth login`);
      console.log(`access token expires ${formatExpiry(login.expires)}`);

      return;
    }
    case "logout":
      await llmOAuth.logout(llmProviderSchema.parse(rawProvider));

      return;
    case "status": {
      const { values } = parseArgs({
        args: args.slice(1),
        options: { json: { type: "boolean", default: false } },
      });
      const logins = (await llmOAuth.list()).map((login) => ({
        provider: login.provider,
        expires: formatExpiry(login.expires),
      }));

      if (values.json) {
        console.log(JSON.stringify(logins));

        return;
      }

      for (const login of logins) {
        console.log(`${login.provider}\t${login.expires}`);
      }

      return;
    }
    default:
      throw new Error("usage: tetherbox-daemon llm <login|logout|status> [provider]");
  }
}

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

async function writeProfileConfig(profileDir: string, profileConfig: ProfileConfig): Promise<void> {
  await writeFile(
    join(profileDir, profileLayout.config),
    `${JSON.stringify(profileConfig, null, 2)}\n`,
  );
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
          ...MODEL_ARG_OPTIONS,
          starter: { type: "string", multiple: true, default: [] },
          "starter-config": { type: "string", multiple: true, default: [] },
        },
      });
      const selectedStarters = resolveStarters(values.starter);
      const starterConfig = starterConfigFlagsSchema.parse(values["starter-config"]);
      const profileConfig = profileConfigSchema.parse({
        name: values.name ?? id,
        slackChannelId: values.channel,
        model: modelInput(values),
        starters: selectedStarters.map((starter) => starter.id),
        starterConfig,
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
        await writeProfileConfig(profileDir, profileConfig);
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
      await reportReload(config, `created ${id}`);

      return;
    }
    case "set-model": {
      const id = profileIdSchema.parse(rawId);
      const { values } = parseArgs({
        args: rest,
        options: MODEL_ARG_OPTIONS,
      });
      const profileDir = join(config.profilesDir, id);
      const current = profileConfigSchema.parse(
        JSON.parse(await readFile(join(profileDir, profileLayout.config), "utf8")),
      );
      const model = modelRefSchema.parse(modelInput(values));

      await writeProfileConfig(profileDir, { ...current, model });
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
