import { useQuery } from "@tanstack/react-query";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { appClient, queryKeys, unwrapJson } from "../../lib/api.ts";
import { SectionHeader, SettingGroup, SettingRow } from "./shared.tsx";

export function SecretsSection({ enabled }: { enabled: boolean }) {
  const secretsQuery = useQuery({
    queryKey: queryKeys.secrets,
    queryFn: async () => unwrapJson(await appClient.secrets.$get()),
    enabled,
  });

  const secrets = secretsQuery.data?.secrets ?? [];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Secrets"
        description="Write-only keys held by the daemon and injected only on pinned hosts."
      />

      <SettingGroup
        title="Stored keys"
        action={
          /* TODO: Wire secret creation in Phase 4 */
          <Button variant="outline" size="xs" disabled>
            Add secret
          </Button>
        }
      >
        {secretsQuery.isPending ? (
          <div className="flex justify-center p-6">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        ) : secrets.length === 0 ? (
          <div className="px-4 py-4 text-xs text-muted-foreground">No secrets stored yet</div>
        ) : (
          secrets.map((entry) => (
            <SettingRow
              key={entry.key}
              title={entry.key}
              control={
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{entry.binding.kind}</Badge>
                  {/* TODO: Wire per-secret update and deletion in Phase 4 */}
                  <Button variant="outline" size="xs" disabled>
                    Configure
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
