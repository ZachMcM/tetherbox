import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LlmProvider, ModelSelection } from "@tetherbox/core/app";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import { FieldError } from "@tetherbox/ui/components/field";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { appClient, queryKeys, unwrapJson } from "../../lib/api.ts";
import {
  appSettingsQueryOptions,
  llmModelsQueryOptions,
  llmStatusQueryOptions,
  secretsQueryOptions,
} from "../../lib/queries.ts";
import { LlmProviderAuthPanel } from "../auth-setup/llm-provider-auth-panel.tsx";
import { findProviderApiKey, isProviderConnected } from "../../lib/auth-status.ts";
import { EffortPicker } from "../effort-picker.tsx";
import { ModelPicker } from "../model-picker.tsx";
import { ProviderIcon } from "../provider-icons.tsx";
import { SectionHeader, SettingGroup, SettingRow } from "./shared.tsx";

export function ProvidersSection() {
  const queryClient = useQueryClient();
  const [activeProviderId, setActiveProviderId] = useState<LlmProvider | null>(null);
  const llmQuery = useQuery(llmStatusQueryOptions);
  const secretsQuery = useQuery(secretsQueryOptions);
  const settingsQuery = useQuery(appSettingsQueryOptions);
  const modelsQuery = useQuery(llmModelsQueryOptions);

  const defaultModelMutation = useMutation({
    mutationFn: async (defaultModel: ModelSelection) =>
      unwrapJson(await appClient.settings.$patch({ json: { defaultModel } })),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings, data);
    },
  });
  const saveDefaultModel = (model: ModelSelection) => defaultModelMutation.mutate(model);

  const providers = llmQuery.data?.providers ?? [];
  const secrets = secretsQuery.data?.secrets ?? [];
  const models = modelsQuery.data?.models ?? [];
  const defaultModel = settingsQuery.data?.defaultModel ?? null;

  const activeProvider =
    activeProviderId === null
      ? undefined
      : providers.find((entry) => entry.provider === activeProviderId);

  if (activeProvider !== undefined) {
    return (
      <div className="space-y-6">
        <SectionHeader
          onBack={() => setActiveProviderId(null)}
          title={
            <span className="inline-flex items-center gap-2.5">
              <ProviderIcon provider={activeProvider.provider} className="size-5" />
              <span>Configure {activeProvider.provider}</span>
            </span>
          }
          description="Credentials are stored by the daemon and injected through the LLM proxy."
        />
        <LlmProviderAuthPanel
          key={activeProvider.provider}
          provider={activeProvider}
          boundApiKey={findProviderApiKey(secrets, activeProvider.provider)}
        />
      </div>
    );
  }

  let content = (
    <>
      {providers.map((item) => {
        const boundKey = findProviderApiKey(secrets, item.provider);
        const descriptionParts: string[] = [];

        if (boundKey !== undefined) {
          descriptionParts.push(boundKey);
        }

        if (item.oauthExpires !== undefined) {
          descriptionParts.push(`${item.oauthLabel ?? "OAuth"} · expires ${item.oauthExpires}`);
        } else if (item.oauthLabel !== undefined && !item.hasApiKey) {
          descriptionParts.push(item.oauthLabel);
        }

        return (
          <SettingRow
            key={item.provider}
            title={
              <span className="inline-flex items-center gap-2">
                <ProviderIcon provider={item.provider} className="size-4" />
                <span>{item.provider}</span>
              </span>
            }
            description={descriptionParts.length > 0 ? descriptionParts.join(" · ") : undefined}
            control={
              <div className="flex items-center gap-2">
                {item.hasApiKey && <Badge>api-key</Badge>}
                {item.oauthExpires !== undefined && <Badge>oauth</Badge>}
                {!isProviderConnected(item) && (
                  <span className="text-xs text-muted-foreground">unset</span>
                )}
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setActiveProviderId(item.provider)}
                >
                  Configure
                </Button>
              </div>
            }
          />
        );
      })}
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
        description="Connect LLM providers and choose the default model for new conversations and background runs."
      />

      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">Default model</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Used for new conversations, cron jobs, webhooks, reminders, and poll jobs unless
            overridden in the composer.
          </p>
        </div>
        {modelsQuery.isPending || settingsQuery.isPending ? (
          <div className="flex justify-center py-2">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <ModelPicker
                models={models}
                value={defaultModel}
                disabled={defaultModelMutation.isPending}
                onChange={saveDefaultModel}
                placeholder="Choose default model…"
              />
            </div>
            <EffortPicker
              models={models}
              value={defaultModel}
              disabled={defaultModelMutation.isPending}
              onChange={saveDefaultModel}
            />
          </div>
        )}
        {defaultModelMutation.error !== null && (
          <FieldError>{defaultModelMutation.error.message}</FieldError>
        )}
      </section>

      <SettingGroup title="Providers">{content}</SettingGroup>
    </div>
  );
}
