import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { Buddy } from "@tetherbox/ui/components/buddy";
import { Button } from "@tetherbox/ui/components/button";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { profilesQueryOptions } from "../../lib/queries.ts";
import { CreateProfileDialog } from "../create-profile-dialog.tsx";
import { SectionHeader, SettingGroup, SettingRow } from "./shared.tsx";

export function ProfilesSection({
  onOpenProfile,
  onProfileCreated,
}: {
  onOpenProfile: (profileId: string) => void;
  onProfileCreated: (profileId: string) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const profilesQuery = useQuery(profilesQueryOptions);
  const profiles = profilesQuery.data?.profiles ?? [];

  let content = (
    <>
      {profiles.map((profile) => (
        <SettingRow
          key={profile.id}
          leading={<Buddy {...profile.buddy} size={30} />}
          title={profile.name}
          description={`${profile.id} · ${profile.config.starters.length} starters`}
          control={
            <Button variant="ghost" size="xs" onClick={() => onOpenProfile(profile.id)}>
              Manage
            </Button>
          }
        />
      ))}
    </>
  );

  if (profilesQuery.isPending) {
    content = (
      <div className="flex justify-center p-6">
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    );
  } else if (profilesQuery.error !== null) {
    content = (
      <div className="px-4 py-4 text-xs text-destructive">{profilesQuery.error.message}</div>
    );
  } else if (profiles.length === 0) {
    content = <div className="px-4 py-4 text-xs text-muted-foreground">No profiles yet</div>;
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Profiles"
        description="Each profile has its own memory, starters, modules, cron jobs, and sessions."
      />
      <SettingGroup
        title="All profiles"
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            <span>New profile</span>
          </Button>
        }
      >
        {content}
      </SettingGroup>
      <CreateProfileDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={onProfileCreated}
      />
    </div>
  );
}
