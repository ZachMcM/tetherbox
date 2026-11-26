import { useQuery } from "@tanstack/react-query";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { appClient, queryKeys, unwrapJson } from "../../lib/api.ts";
import { SectionHeader, SettingGroup, SettingRow } from "./shared.tsx";

export function ProfileSettingsSection({ profileId }: { profileId: string }) {
  const profileQuery = useQuery({
    queryKey: queryKeys.profile(profileId),
    queryFn: async () =>
      unwrapJson(await appClient.profiles[":profileId"].$get({ param: { profileId } })),
  });

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
      <SectionHeader title={profile.config.name} description={`Profile ID: ${profile.id}`} />

      <SettingGroup
        title="Model & starters"
        action={
          /* TODO: Wire profile config and starter editing in Phase 4 */
          <Button variant="outline" size="xs" disabled>
            Edit
          </Button>
        }
      >
        <SettingRow
          title="Model"
          description={`${profile.config.model.provider}/${profile.config.model.id}`}
          control={<Badge variant="secondary">{profile.config.model.auth}</Badge>}
        />
        <SettingRow
          title="Starters"
          control={
            profile.config.starters.length === 0 ? (
              <span className="text-xs text-muted-foreground">None enabled</span>
            ) : (
              <div className="flex flex-wrap justify-end gap-1">
                {profile.config.starters.map((starter) => (
                  <Badge key={starter} variant="secondary">
                    {starter}
                  </Badge>
                ))}
              </div>
            )
          }
        />
      </SettingGroup>

      <section className="space-y-2.5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">MEMORY.md</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Loaded into every turn for this profile.
            </p>
          </div>
          {/* TODO: Wire MEMORY.md editing in Phase 4 */}
          <Button variant="outline" size="xs" disabled>
            Edit
          </Button>
        </div>
        <pre className="max-h-48 overflow-auto rounded-xl border border-border bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap">
          {profile.memory || "(empty)"}
        </pre>
      </section>

      <SettingGroup title="Automation">
        <SettingRow
          title="Cron jobs"
          control={<Badge variant="outline">{profile.cron.length}</Badge>}
        />
        <SettingRow
          title="Webhooks"
          control={<Badge variant="outline">{profile.webhooks.length}</Badge>}
        />
      </SettingGroup>
    </div>
  );
}
