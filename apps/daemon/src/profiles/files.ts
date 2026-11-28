import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  modelSelectionSchema,
  profileConfigSchema,
  profileLayout,
  RpcError,
  type CreateProfileInput,
  type ProfileConfig,
  type ProfileId,
  starterPath,
  type UpdateProfileInput,
} from "@tetherbox/core";
import { z } from "zod";
import { isMissing } from "../file-store.ts";
import { commitAll, commitFile, initRepo } from "./git-repo.ts";
import { loadProfile } from "./registry.ts";
import type { StarterCatalog } from "./starter-catalog.ts";

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

export async function createProfileOnDisk({
  profilesDir,
  catalog,
  input,
}: {
  profilesDir: string;
  catalog: StarterCatalog;
  input: CreateProfileInput;
}): Promise<ProfileConfig> {
  const selectedStarters = catalog.resolve(input.starters);
  const profileConfig = profileConfigSchema.parse({
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
    await writeFile(join(profileDir, profileLayout.memory), `# ${input.name}\n`);

    for (const starter of selectedStarters) {
      await catalog.copyInto({ profileId: input.id, profileDir, starter });
    }

    await initRepo(profileDir);
    await commitAll(profileDir, "Initialize profile");
  } catch (error) {
    await rm(profileDir, { recursive: true, force: true });
    throw error;
  }

  return profileConfig;
}

export async function updateProfileOnDisk({
  profilesDir,
  catalog,
  id,
  input,
}: {
  profilesDir: string;
  catalog: StarterCatalog;
  id: ProfileId;
  input: Pick<UpdateProfileInput, "starters" | "starterConfig">;
}): Promise<ProfileConfig> {
  const profileDir = join(profilesDir, id);

  if (!(await pathExists(profileDir))) {
    throw new RpcError(404, `profile "${id}" does not exist`);
  }

  const load = await loadProfile(id, profileDir);

  if (load.kind === "invalid") {
    throw new RpcError(400, load.issues.map((issue) => issue.message).join("; "));
  }

  const current = load.profile.config;
  const currentStarterIds = catalog.enabledIds(load.profile);
  const resolvedStarters = catalog.resolve(input.starters ?? currentStarterIds);
  const nextStarterSet = new Set(resolvedStarters.map((starter) => starter.id));
  const updated = profileConfigSchema.parse({
    starters: resolvedStarters.map((starter) => starter.id),
    starterConfig: input.starterConfig ?? current.starterConfig,
  });

  for (const starter of resolvedStarters) {
    const destination = join(profileDir, starterPath(starter));

    if (!(await pathExists(destination))) {
      await catalog.copyInto({ profileId: id, profileDir, starter });
    }
  }

  if (input.starters !== undefined) {
    const removedIds = currentStarterIds.filter((starterId) => !nextStarterSet.has(starterId));

    for (const starter of catalog.all()) {
      if (removedIds.includes(starter.id)) {
        await rm(join(profileDir, starterPath(starter)), { recursive: true, force: true });
      }
    }
  }

  await writeProfileConfigFile(profileDir, updated);

  return updated;
}

const legacyProfileFieldsSchema = z.object({
  name: z.string().trim().min(1).optional().catch(undefined),
  model: modelSelectionSchema.optional().catch(undefined),
});

export async function takeLegacyProfileFields(
  profileDir: string,
): Promise<z.infer<typeof legacyProfileFieldsSchema>> {
  const path = join(profileDir, profileLayout.config);
  let raw: unknown;

  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }

  if (typeof raw !== "object" || raw === null || !("name" in raw || "model" in raw)) {
    return {};
  }

  const legacy = legacyProfileFieldsSchema.parse(raw);
  const config = profileConfigSchema.safeParse(raw);

  if (config.success) {
    await writeProfileConfigFile(profileDir, config.data);
    await commitFile({
      dir: profileDir,
      file: profileLayout.config,
      message: "Move profile name and model to Tetherbox settings",
    });
  }

  return legacy;
}

export async function deleteProfileOnDisk(profilesDir: string, id: ProfileId): Promise<void> {
  const profileDir = join(profilesDir, id);

  if (!(await pathExists(profileDir))) {
    throw new RpcError(404, `profile "${id}" does not exist`);
  }

  await rm(profileDir, { recursive: true, force: true });
}
