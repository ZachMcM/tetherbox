import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { Button } from "@tetherbox/ui/components/button";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { profilesQueryOptions } from "../../lib/queries.ts";
import { CreateProfileForm } from "../create-profile-form.tsx";
import { SectionHeader, SettingGroup, SettingRow } from "./shared.tsx";

export function ProfilesSection({ onOpenProfile }: { onOpenProfile: (profileId: string) => void }) {
  const [creating, setCreating] = useState(false);
  const profilesQuery = useQuery(profilesQueryOptions);

  if (creating) {
    return (
      <div className="space-y-6">
        <CreateProfileForm
          idPrefix="settings-create-profile"
          title="New profile"
          secondaryAction={
            <Button type="button" variant="outline" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          }
          renderHeader={({ title, description }) => (
            <SectionHeader
              onBack={() => setCreating(false)}
              title={title}
              description={description}
            />
          )}
          renderFooter={(actions) => <div className="flex justify-end gap-2 pt-2">{actions}</div>}
          onCreated={onOpenProfile}
        />
      </div>
    );
  }

  const profiles = profilesQuery.data?.profiles ?? [];
  let content = (
    <>
      {profiles.map((profile) => (
        <SettingRow
          key={profile.id}
          title={profile.config.name}
          description={`${profile.id} · ${profile.config.starters.length} starters`}
          control={
            <Button variant="outline" size="xs" onClick={() => onOpenProfile(profile.id)}>
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
          <Button variant="outline" size="xs" onClick={() => setCreating(true)}>
            <PlusIcon className="size-3.5" />
            <span>New profile</span>
          </Button>
        }
      >
        {content}
      </SettingGroup>
    </div>
  );
}
