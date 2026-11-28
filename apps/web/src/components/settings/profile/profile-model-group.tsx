import { useMutation } from "@tanstack/react-query";
import type { ProfileDetail } from "@tetherbox/core/app";
import { Button } from "@tetherbox/ui/components/button";
import { appClient, unwrapJson } from "../../../lib/api.ts";
import { SettingGroup, SettingRow } from "../shared.tsx";
import { ProfileIdentityRow } from "./profile-identity-row.tsx";

export function ProfileModelGroup({
  profile,
  onUpdated,
}: {
  profile: ProfileDetail;
  onUpdated: (data: { profile: ProfileDetail }) => void;
}) {
  const profileId = profile.id;

  const clearModelOverrideMutation = useMutation({
    mutationFn: async () =>
      unwrapJson(
        await appClient.profiles[":profileId"].$patch({
          param: { profileId },
          json: { model: null },
        }),
      ),
    onSuccess: onUpdated,
  });

  return (
    <SettingGroup title="Profile">
      <ProfileIdentityRow key={profile.name} profile={profile} onSaved={onUpdated} />
      {profile.model !== null && (
        <SettingRow
          title="Pinned model override"
          description={`${profile.model.provider}/${profile.model.id} (${profile.model.auth})`}
          control={
            <Button
              variant="ghost"
              size="xs"
              disabled={clearModelOverrideMutation.isPending}
              onClick={() => clearModelOverrideMutation.mutate()}
            >
              Use default
            </Button>
          }
        />
      )}
    </SettingGroup>
  );
}
