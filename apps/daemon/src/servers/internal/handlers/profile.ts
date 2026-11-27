import type { ProfileValidationHandlers } from "@tetherbox/core";
import { loadProfile, type ProfileRegistry } from "../../../profiles/registry.ts";

export function createProfileValidationHandlers({
  registry,
}: {
  registry: ProfileRegistry;
}): ProfileValidationHandlers {
  return {
    async validate(run) {
      const profile = registry.get(run.profileId);

      if (profile === undefined) {
        return { ok: false, issues: [{ file: run.profileId, message: "profile is not loaded" }] };
      }

      const load = await loadProfile(profile.id, profile.dir);

      return load.issues.length === 0 ? { ok: true } : { ok: false, issues: load.issues };
    },
  };
}
