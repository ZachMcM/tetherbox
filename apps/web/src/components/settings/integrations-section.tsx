import { useQuery } from "@tanstack/react-query";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { appClient, queryKeys, unwrapJson } from "../../lib/api.ts";
import { SectionHeader, SettingGroup, SettingRow } from "./shared.tsx";

export function IntegrationsSection({ enabled }: { enabled: boolean }) {
  const oauthQuery = useQuery({
    queryKey: queryKeys.oauthStatus,
    queryFn: async () => unwrapJson(await appClient.oauth.status.$get()),
    enabled,
  });

  const presets = oauthQuery.data?.presets ?? [];
  const activeCount = oauthQuery.data?.logins.length ?? 0;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Integrations"
        description={`Connected OAuth tokens managed by the daemon (${activeCount} active).`}
      />

      <SettingGroup title="OAuth presets">
        {oauthQuery.isPending ? (
          <div className="flex justify-center p-6">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        ) : (
          presets.map((preset) => (
            <SettingRow
              key={preset.id}
              title={preset.label}
              description={preset.secretKey}
              control={
                <div className="flex items-center gap-2">
                  <Badge variant={preset.hasClientCredentials ? "secondary" : "outline"}>
                    {preset.hasClientCredentials ? "ready" : "needs client secret"}
                  </Badge>
                  {/* TODO: Wire per-integration OAuth connect flow in Phase 4 */}
                  <Button variant="outline" size="xs" disabled>
                    Connect
                  </Button>
                </div>
              }
            />
          ))
        )}
      </SettingGroup>
    </div>
  );
}
