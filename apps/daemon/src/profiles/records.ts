import { access } from "node:fs/promises";
import { join } from "node:path";
import type { ProfileTable } from "../db/profiles.ts";
import { isMissing } from "../file-store.ts";
import { takeLegacyProfileFields } from "./files.ts";
import type { LoadedProfile, ProfileRegistry } from "./registry.ts";

async function dirExists(path: string): Promise<boolean> {
  try {
    await access(path);

    return true;
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }

    throw error;
  }
}

export async function importProfileRecord({
  profile,
  table,
}: {
  profile: Pick<LoadedProfile, "id" | "dir">;
  table: ProfileTable;
}): Promise<void> {
  if (!(await dirExists(profile.dir))) {
    return;
  }

  const legacy = await takeLegacyProfileFields(profile.dir);
  const existing = table.find(profile.id);

  if (existing !== undefined && legacy.name === undefined && legacy.model === undefined) {
    return;
  }

  const record = existing ?? { name: profile.id, model: null };

  table.upsert(profile.id, {
    name: record.name === profile.id ? (legacy.name ?? record.name) : record.name,
    model: record.model ?? legacy.model ?? null,
  });
}

export async function reconcileProfileRecords({
  profilesDir,
  registry,
  table,
}: {
  profilesDir: string;
  registry: ProfileRegistry;
  table: ProfileTable;
}): Promise<void> {
  for (const profile of registry.all()) {
    await importProfileRecord({ profile, table });
  }

  for (const id of table.ids()) {
    if (!(await dirExists(join(profilesDir, id)))) {
      table.delete(id);
    }
  }
}
