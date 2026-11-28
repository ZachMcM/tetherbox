import { RpcError, type ProfileId } from "@tetherbox/core";
import type { LoadedProfile, ProfileRegistry } from "../../../profiles/registry.ts";

export function requireProfile(registry: ProfileRegistry, id: ProfileId): LoadedProfile {
  const profile = registry.get(id);

  if (profile === undefined) {
    throw new RpcError(404, `profile "${id}" not found`);
  }

  return profile;
}
