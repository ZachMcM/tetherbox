import { useMutation } from "@tanstack/react-query";
import type { ProfileDetail } from "@tetherbox/core/app";
import { Button } from "@tetherbox/ui/components/button";
import { appClient, unwrapJson } from "../../../lib/api.ts";
import { SettingGroup, SettingRow } from "../shared.tsx";
import { ProfileNameRow } from "./profile-name-row.tsx";

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
      <ProfileNameRow key={profile.config.name} profile={profile} onSaved={onUpdated} />
      {profile.config.model !== undefined && (
        <SettingRow
          title="Pinned model override"
          description={`${profile.config.model.provider}/${profile.config.model.id} (${profile.config.model.auth})`}
          control={
            <Button
              variant="outline"
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
