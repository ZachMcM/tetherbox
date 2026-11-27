import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { LlmProvider, LlmProviderStatus, ModelRef } from "@tetherbox/core/app";
import { ArrowLeftIcon, CheckCircle2Icon } from "lucide-react";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@tetherbox/ui/components/card";
import { Field, FieldError, FieldLabel } from "@tetherbox/ui/components/field";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { appClient, queryKeys, unwrapJson } from "../lib/api.ts";
import {
  llmModelsQueryOptions,
  llmStatusQueryOptions,
  secretsQueryOptions,
} from "../lib/queries.ts";
import {
  findProviderApiKey,
  isProviderConnected,
  LlmProviderAuthPanel,
} from "./auth-setup-panels.tsx";
import { ModelPicker, resolveAvailableModel } from "./model-picker.tsx";
import { ProviderIcon } from "./provider-icons.tsx";

function connectionLabel(provider: LlmProviderStatus): string {
  if (provider.hasApiKey && provider.oauthExpires !== undefined) {
    return "api-key + oauth";
  }

  return provider.hasApiKey ? "api-key" : "oauth";
}

export function OnboardingScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeProviderId, setActiveProviderId] = useState<LlmProvider | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelRef | null>(null);

  const llmStatusQuery = useQuery(llmStatusQueryOptions);
  const secretsQuery = useQuery(secretsQueryOptions);
  const llmModelsQuery = useQuery(llmModelsQueryOptions);

  const providers = llmStatusQuery.data?.providers ?? [];
  const secrets = secretsQuery.data?.secrets ?? [];
  const models = llmModelsQuery.data?.models ?? [];

  const configuredProviders = providers.filter(isProviderConnected);
  const activeProvider =
    activeProviderId === null
      ? undefined
      : providers.find((entry) => entry.provider === activeProviderId);

  const effectiveDefaultModel = resolveAvailableModel(models, [selectedModel]);

  const completeMutation = useMutation({
    mutationFn: async () =>
      unwrapJson(
        await appClient.settings.$patch({
          json: { defaultModel: effectiveDefaultModel, onboardingCompleted: true },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings, data);
      void navigate({ to: "/", replace: true });
    },
  });

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          {activeProvider !== undefined && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="-ml-2 mb-3 w-fit text-muted-foreground"
              onClick={() => setActiveProviderId(null)}
            >
              <ArrowLeftIcon className="size-3.5" />
              <span>Back</span>
            </Button>
          )}
          <CardTitle>
            {activeProvider !== undefined ? (
              <span className="inline-flex items-center gap-2">
                <ProviderIcon provider={activeProvider.provider} className="size-4" />
                <span>Configure {activeProvider.provider}</span>
              </span>
            ) : (
              "Set up model providers"
            )}
          </CardTitle>
          <CardDescription>
            {activeProvider !== undefined
              ? "Credentials are stored by the daemon and injected through the LLM proxy."
              : "Connect at least one LLM provider and choose a default model. You can add more providers or switch models in the composer anytime."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {activeProvider !== undefined ? (
            <LlmProviderAuthPanel
              key={activeProvider.provider}
              provider={activeProvider}
              boundApiKey={findProviderApiKey(secrets, activeProvider.provider)}
            />
          ) : (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">1. Connect providers</span>
                  <span className="text-xs text-muted-foreground">
                    {configuredProviders.length} connected
                  </span>
                </div>

                {llmStatusQuery.isPending ? (
                  <div className="flex justify-center py-6">
                    <Spinner className="size-4 text-muted-foreground" />
                  </div>
                ) : llmStatusQuery.error !== null ? (
                  <FieldError>{llmStatusQuery.error.message}</FieldError>
                ) : (
                  <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border">
                    {providers.map((item) => {
                      const connected = isProviderConnected(item);

                      return (
                        <div
                          key={item.provider}
                          className="flex items-center justify-between gap-4 px-3.5 py-2.5"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <ProviderIcon provider={item.provider} className="size-4" />
                            <div className="min-w-0">
                              <div className="text-sm font-medium">{item.provider}</div>
                              {item.oauthLabel !== undefined && (
                                <div className="text-xs text-muted-foreground">
                                  {item.oauthLabel}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {connected && (
                              <Badge className="gap-1">
                                <CheckCircle2Icon className="size-3" />
                                <span>{connectionLabel(item)}</span>
                              </Badge>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              onClick={() => setActiveProviderId(item.provider)}
                            >
                              {connected ? "Manage" : "Configure"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <Field>
                <FieldLabel className="text-sm font-semibold">2. Default model</FieldLabel>
                <ModelPicker
                  models={models}
                  value={effectiveDefaultModel}
                  onChange={setSelectedModel}
                  placeholder="Choose a default model…"
                />
              </Field>
            </>
          )}

          {completeMutation.error !== null && (
            <FieldError>{completeMutation.error.message}</FieldError>
          )}
        </CardContent>

        <CardFooter className="justify-between border-t pt-4">
          <Button
            type="button"
            variant="destructive-outline"
            size="sm"
            disabled={completeMutation.isPending}
            onClick={() => completeMutation.mutate()}
          >
            Skip for now
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={
              completeMutation.isPending ||
              activeProvider !== undefined ||
              effectiveDefaultModel === null
            }
            onClick={() => completeMutation.mutate()}
          >
            {completeMutation.isPending ? "Saving…" : "Finish setup"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
