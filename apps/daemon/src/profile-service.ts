import { execFile } from "node:child_process";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  profileConfigSchema,
  profileLayout,
  RpcError,
  type CreateProfileInput,
  type ProfileConfig,
  type ProfileId,
  type StarterSummary,
  type UpdateProfileInput,
} from "@tetherbox/core";
import { resolveStarters, starters, templatesDir, type Starter } from "@tetherbox/starters";
import { isMissing } from "./file-store.ts";

const execFileAsync = promisify(execFile);

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);

    return true;
  } catch {
    return false;
  }
}

function resolveStartersOrThrow(ids: readonly string[]): Starter[] {
  try {
    return resolveStarters(ids);
  } catch (error) {
    throw new RpcError(400, error instanceof Error ? error.message : String(error));
  }
}

async function readProfileConfigFile(profileDir: string): Promise<ProfileConfig> {
  return profileConfigSchema.parse(
    JSON.parse(await readFile(join(profileDir, profileLayout.config), "utf8")),
  );
}

async function writeProfileConfigFile(
  profileDir: string,
  profileConfig: ProfileConfig,
): Promise<void> {
  await writeFile(
    join(profileDir, profileLayout.config),
    `${JSON.stringify(profileConfig, null, 2)}\n`,
  );
}

export async function readProfileMemoryFile(profileDir: string): Promise<string> {
  try {
    return await readFile(join(profileDir, profileLayout.memory), "utf8");
  } catch (error) {
    if (isMissing(error)) {
      return "";
    }

    throw error;
  }
}

export async function writeProfileMemoryFile(profileDir: string, content: string): Promise<void> {
  await writeFile(join(profileDir, profileLayout.memory), content);
}

export async function createProfileOnDisk(
  profilesDir: string,
  input: CreateProfileInput,
): Promise<ProfileConfig> {
  const selectedStarters = resolveStartersOrThrow(input.starters);
  const profileConfig = profileConfigSchema.parse({
    name: input.name,
    model: input.model,
    starters: selectedStarters.map((starter) => starter.id),
    starterConfig: input.starterConfig,
  });
  const profileDir = join(profilesDir, input.id);

  await mkdir(profilesDir, { recursive: true });

  try {
    await mkdir(profileDir);
  } catch (error) {
    if (isAlreadyExists(error)) {
      throw new RpcError(409, `profile "${input.id}" already exists at ${profileDir}`);
    }

    throw error;
  }

  try {
    await writeProfileConfigFile(profileDir, profileConfig);
    await writeFile(join(profileDir, profileLayout.memory), `# ${profileConfig.name}\n`);

    for (const starter of selectedStarters) {
      await cp(join(templatesDir, starter.path), join(profileDir, starter.path), {
        recursive: true,
      });
    }

    await execFileAsync("git", ["init", "-q"], { cwd: profileDir });
    await execFileAsync("git", ["config", "user.name", "Tetherbox"], { cwd: profileDir });
    await execFileAsync("git", ["config", "user.email", "tetherbox@localhost"], {
      cwd: profileDir,
    });
    await execFileAsync("git", ["config", "commit.gpgsign", "false"], { cwd: profileDir });
    await execFileAsync("git", ["add", "-A"], { cwd: profileDir });
    await execFileAsync(
      "git",
      ["commit", "-q", "--no-verify", "--no-gpg-sign", "-m", "Initialize profile"],
      {
        cwd: profileDir,
      },
    );
  } catch (error) {
    await rm(profileDir, { recursive: true, force: true });
    throw error;
  }

  return profileConfig;
}

export async function updateProfileOnDisk(
  profilesDir: string,
  id: ProfileId,
  input: UpdateProfileInput,
): Promise<ProfileConfig> {
  const profileDir = join(profilesDir, id);

  if (!(await pathExists(profileDir))) {
    throw new RpcError(404, `profile "${id}" does not exist`);
  }

  const current = await readProfileConfigFile(profileDir);
  const nextStarterIds = input.starters ?? current.starters;
  const resolvedStarters = resolveStartersOrThrow(nextStarterIds);
  const nextStarterSet = new Set(resolvedStarters.map((starter) => starter.id));
  const updated = profileConfigSchema.parse({
    name: input.name ?? current.name,
    model: input.model ?? current.model,
    starters: resolvedStarters.map((starter) => starter.id),
    starterConfig: input.starterConfig ?? current.starterConfig,
  });

  for (const starter of resolvedStarters) {
    const destination = join(profileDir, starter.path);

    if (!(await pathExists(destination))) {
      await cp(join(templatesDir, starter.path), destination, { recursive: true });
    }
  }

  if (input.starters !== undefined) {
    const removedIds = current.starters.filter((starterId) => !nextStarterSet.has(starterId));

    for (const starter of starters) {
      if (removedIds.includes(starter.id)) {
        await rm(join(profileDir, starter.path), { recursive: true, force: true });
      }
    }
  }

  await writeProfileConfigFile(profileDir, updated);

  return updated;
}

export async function deleteProfileOnDisk(profilesDir: string, id: ProfileId): Promise<void> {
  const profileDir = join(profilesDir, id);

  if (!(await pathExists(profileDir))) {
    throw new RpcError(404, `profile "${id}" does not exist`);
  }

  await rm(profileDir, { recursive: true, force: true });
}

export function listStarterSummaries(): StarterSummary[] {
  return starters.map((starter) => ({
    id: starter.id,
    kind: starter.kind,
    category: starter.category,
    configFields: "configFields" in starter ? starter.configFields : [],
    secrets: starter.secrets,
    ...("oauthPreset" in starter && starter.oauthPreset !== undefined
      ? { oauthPreset: starter.oauthPreset }
      : {}),
  }));
}
