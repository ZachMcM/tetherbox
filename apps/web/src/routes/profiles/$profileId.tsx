import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@tetherbox/ui/components/card";
import { Separator } from "@tetherbox/ui/components/separator";
import { SidebarTrigger } from "@tetherbox/ui/components/sidebar";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { appClient, queryKeys, unwrapJson } from "../../lib/api.ts";

function ProfilePage() {
  const { profileId } = Route.useParams();

  const profileQuery = useQuery({
    queryKey: queryKeys.profile(profileId),
    queryFn: async () =>
      unwrapJson(await appClient.profiles[":profileId"].$get({ param: { profileId } })),
  });

  if (profileQuery.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }

  const profile = profileQuery.data?.profile;

  if (profileQuery.error !== null || profile === undefined) {
    return (
      <div className="flex flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-2 px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-vertical:h-4 data-vertical:self-center"
          />
          <span className="text-sm font-medium">Profile unavailable</span>
        </header>
        <div className="p-6 text-sm text-muted-foreground">
          {profileQuery.error?.message ?? "Profile not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-2 px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mr-2 data-vertical:h-4 data-vertical:self-center"
        />
        <h1 className="text-sm font-medium">{profile.config.name}</h1>
        <Badge variant="outline">{profile.id}</Badge>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto grid max-w-3xl gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Model & starters</CardTitle>
              <CardDescription>
                {profile.config.model.provider}/{profile.config.model.id} (
                {profile.config.model.auth})
              </CardDescription>
              <CardAction>
                {/* TODO: Wire profile config and starter editing in Phase 4 */}
                <Button variant="outline" size="sm" disabled>
                  Edit
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {profile.config.starters.length === 0 ? (
                <span className="text-sm text-muted-foreground">No starters enabled</span>
              ) : (
                profile.config.starters.map((starter) => (
                  <Badge key={starter} variant="secondary">
                    {starter}
                  </Badge>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>MEMORY.md</CardTitle>
              <CardDescription>Loaded into every turn for this profile.</CardDescription>
              <CardAction>
                {/* TODO: Wire MEMORY.md editing in Phase 4 */}
                <Button variant="outline" size="sm" disabled>
                  Edit
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <pre className="max-h-64 overflow-auto rounded-xl bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
                {profile.memory || "(empty)"}
              </pre>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Cron jobs ({profile.cron.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {profile.cron.length === 0 ? (
                  <span className="text-muted-foreground">None configured</span>
                ) : (
                  profile.cron.map(({ name, job }) => (
                    <div key={name} className="rounded-lg border p-2">
                      <div className="font-medium">{name}</div>
                      <div className="font-mono text-muted-foreground">{job.schedule}</div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Webhooks ({profile.webhooks.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {profile.webhooks.length === 0 ? (
                  <span className="text-muted-foreground">None configured</span>
                ) : (
                  profile.webhooks.map(({ name, webhook }) => (
                    <div key={name} className="rounded-lg border p-2">
                      <div className="font-medium">{name}</div>
                      <div className="font-mono text-muted-foreground">
                        /hooks/{profile.id}/{name} ({webhook.verify.kind})
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/profiles/$profileId")({
  component: ProfilePage,
});
