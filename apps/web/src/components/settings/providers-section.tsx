import { useQuery } from "@tanstack/react-query";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { appClient, queryKeys, unwrapJson } from "../../lib/api.ts";
import { SectionHeader, SettingGroup, SettingRow } from "./shared.tsx";

export function ProvidersSection() {
  const llmQuery = useQuery({
    queryKey: queryKeys.llmStatus,
    queryFn: async () => unwrapJson(await appClient.llm.status.$get()),
  });

  const providers = llmQuery.data?.providers ?? [];

  let content = (
    <>
      {providers.map((item) => (
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
      ))}
    </>
  );

  if (llmQuery.isPending) {
    content = (
      <div className="flex justify-center p-6">
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    );
  } else if (llmQuery.error !== null) {
    content = <div className="px-4 py-4 text-xs text-destructive">{llmQuery.error.message}</div>;
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Models & Providers"
        description="Configured API keys and OAuth logins available to profiles."
      />

      <SettingGroup title="Providers">{content}</SettingGroup>
    </div>
  );
}
