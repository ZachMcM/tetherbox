import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProfileDetail } from "@tetherbox/core/app";
import { AlertCircleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@tetherbox/ui/components/alert";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { appClient, queryKeys, unwrapJson } from "../../../lib/api.ts";
import { useStarterSetupState } from "../../profile-form-fields.tsx";
import { SectionHeader } from "../shared.tsx";
import { AutomationGroup } from "./automation-group.tsx";
import { DangerZone } from "./danger-zone.tsx";
import { ProfileMemorySection } from "./memory-editor.tsx";
import { ProfileModelGroup } from "./profile-model-group.tsx";
import { StartersGroup } from "./starters-group.tsx";

export function ProfileSettingsSection({
  profileId,
  onBack,
  onDeleted,
}: {
  profileId: string;
  onDeleted: () => void;
  onBack?: (() => void) | undefined;
}) {
  const queryClient = useQueryClient();
  const starterSetup = useStarterSetupState();

  const profileQuery = useQuery({
    queryKey: queryKeys.profile(profileId),
    queryFn: async () =>
      unwrapJson(await appClient.profiles[":profileId"].$get({ param: { profileId } })),
  });

  const applyProfileUpdate = (data: { profile: ProfileDetail }) => {
    queryClient.setQueryData(queryKeys.profile(profileId), data);
    void queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
  };

  if (profileQuery.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }

  const profile = profileQuery.data?.profile;

  if (profileQuery.error !== null || profile === undefined) {
    return (
      <div className="text-sm text-muted-foreground">
        {profileQuery.error?.message ?? "Profile not found."}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        onBack={onBack}
        title={profile.config.name}
        description={`Profile ID: ${profile.id}`}
      />

      {profile.issues.length > 0 && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Profile validation issues</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {profile.issues.map((issue) => (
                <li key={`${issue.file}:${issue.message}`}>
                  <code>{issue.file}</code>: {issue.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <ProfileModelGroup profile={profile} onUpdated={applyProfileUpdate} />
      <StartersGroup profile={profile} setup={starterSetup} onUpdated={applyProfileUpdate} />
      <ProfileMemorySection profile={profile} />
      <AutomationGroup profile={profile} />
      <DangerZone profile={profile} onDeleted={onDeleted} />
    </div>
  );
}
