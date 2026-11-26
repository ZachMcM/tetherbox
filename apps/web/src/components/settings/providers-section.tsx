import { useQuery } from "@tanstack/react-query";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { appClient, queryKeys, unwrapJson } from "../../lib/api.ts";
import { SectionHeader, SettingGroup, SettingRow } from "./shared.tsx";

export function ProvidersSection({ enabled }: { enabled: boolean }) {
  const llmQuery = useQuery({
    queryKey: queryKeys.llmStatus,
    queryFn: async () => unwrapJson(await appClient.llm.status.$get()),
    enabled,
  });

  const providers = llmQuery.data?.providers ?? [];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Models & Providers"
        description="Configured API keys and OAuth logins available to profiles."
      />

      <SettingGroup title="Providers">
        {llmQuery.isPending ? (
          <div className="flex justify-center p-6">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        ) : (
          providers.map((item) => (
            <SettingRow
              key={item.provider}
              title={item.provider}
              control={
                <div className="flex items-center gap-2">
                  {item.hasApiKey && <Badge variant="secondary">api-key</Badge>}
                  {item.oauthExpires !== undefined && <Badge variant="secondary">oauth</Badge>}
                  {!item.hasApiKey && item.oauthExpires === undefined && (
                    <span className="text-xs text-muted-foreground">unset</span>
                  )}
                  {/* TODO: Wire per-provider API key and OAuth login configuration in Phase 4 */}
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
