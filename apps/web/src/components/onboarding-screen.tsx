import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { LlmProvider, LlmProviderStatus, ModelSelection } from "@tetherbox/core/app";
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
import { FieldError } from "@tetherbox/ui/components/field";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { appClient, queryKeys, unwrapJson } from "../lib/api.ts";
import {
  appSettingsQueryOptions,
  llmModelsQueryOptions,
  llmStatusQueryOptions,
  secretsQueryOptions,
} from "../lib/queries.ts";
import { LlmProviderAuthPanel } from "./auth-setup/llm-provider-auth-panel.tsx";
import { findProviderApiKey, isProviderConnected } from "../lib/auth-status.ts";
import { CreateProfileForm } from "./create-profile-form.tsx";
import { EffortPicker } from "./effort-picker.tsx";
import { ModelPicker, resolveAvailableModel } from "./model-picker.tsx";
import { ProviderIcon } from "./provider-icons.tsx";

function connectionLabel(provider: LlmProviderStatus): string {
  if (provider.hasApiKey && provider.oauthExpires !== undefined) {
    return "api-key + oauth";
  }

  return provider.hasApiKey ? "api-key" : "oauth";
}

function OnboardingPage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">{children}</div>
  );
}

export function OnboardingScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"providers" | "model" | "profile">("providers");
  const [activeProviderId, setActiveProviderId] = useState<LlmProvider | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelSelection | null>(null);
  const [createdProfileId, setCreatedProfileId] = useState<string | null>(null);

  const llmStatusQuery = useQuery(llmStatusQueryOptions);
  const secretsQuery = useQuery(secretsQueryOptions);
  const llmModelsQuery = useQuery(llmModelsQueryOptions);
  const settingsQuery = useQuery(appSettingsQueryOptions);

  const providers = llmStatusQuery.data?.providers ?? [];
  const secrets = secretsQuery.data?.secrets ?? [];
  const models = llmModelsQuery.data?.models ?? [];

  const configuredProviders = providers.filter(isProviderConnected);
  const activeProvider =
    activeProviderId === null
      ? undefined
      : providers.find((entry) => entry.provider === activeProviderId);

  const effectiveDefaultModel = resolveAvailableModel(models, [
    selectedModel,
    settingsQuery.data?.defaultModel,
  ]);

  const completeMutation = useMutation({
    mutationFn: async (_profileId: string | null) =>
      unwrapJson(
        await appClient.settings.$patch({
          json:
            selectedModel !== null
              ? { defaultModel: effectiveDefaultModel, onboardingCompleted: true }
              : { onboardingCompleted: true },
        }),
      ),
    onSuccess: (data, profileId) => {
      queryClient.setQueryData(queryKeys.settings, data);
      void navigate({
        to: "/",
        search: profileId !== null ? { profile: profileId } : {},
        replace: true,
      });
    },
  });

  const skipButton = (
    <Button
      type="button"
      variant="destructive-outline"
      size="sm"
      className="mr-auto"
      disabled={completeMutation.isPending}
      onClick={() => completeMutation.mutate(null)}
    >
      Skip for now
    </Button>
  );

  if (createdProfileId !== null) {
    return (
      <OnboardingPage>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Profile created</CardTitle>
            <CardDescription>
              {completeMutation.error === null
                ? "Finishing setup…"
                : "Your profile was created, but setup could not be finished."}
            </CardDescription>
          </CardHeader>
          {completeMutation.error !== null && (
            <>
              <CardContent>
                <FieldError>{completeMutation.error.message}</FieldError>
              </CardContent>
              <CardFooter className="justify-end border-t pt-4">
                <Button
                  type="button"
                  size="sm"
                  disabled={completeMutation.isPending}
                  onClick={() => completeMutation.mutate(createdProfileId)}
                >
                  Retry
                </Button>
              </CardFooter>
            </>
          )}
        </Card>
      </OnboardingPage>
    );
  }

  if (step === "profile") {
    return (
      <OnboardingPage>
        <Card className="max-h-[90svh] w-full max-w-2xl px-4">
          <CreateProfileForm
            idPrefix="onboarding-profile"
            title="3. Create your first profile"
            secondaryAction={
              <>
                <Button type="button" variant="ghost" size="sm" onClick={() => setStep("model")}>
                  <ArrowLeftIcon className="size-3.5" />
                  <span>Back</span>
                </Button>
                {skipButton}
              </>
            }
            renderHeader={({ title, description }) => (
              <div className="space-y-1">
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
                {completeMutation.error !== null && (
                  <FieldError>{completeMutation.error.message}</FieldError>
                )}
              </div>
            )}
            renderFooter={(actions) => (
              <CardFooter className="-mx-4 justify-end gap-2">{actions}</CardFooter>
            )}
            onCreated={(profileId) => {
              setCreatedProfileId(profileId);
              completeMutation.mutate(profileId);
            }}
          />
        </Card>
      </OnboardingPage>
    );
  }

  if (step === "model") {
    return (
      <OnboardingPage>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>2. Choose a default model</CardTitle>
            <CardDescription>
              Used for new conversations, cron jobs, webhooks, reminders, and poll jobs. You can
              switch models and reasoning effort in the composer anytime.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <ModelPicker
                  models={models}
                  value={effectiveDefaultModel}
                  onChange={setSelectedModel}
                  placeholder="Choose a default model…"
                />
              </div>
              <EffortPicker
                models={models}
                value={effectiveDefaultModel}
                onChange={setSelectedModel}
              />
            </div>
            {completeMutation.error !== null && (
              <FieldError>{completeMutation.error.message}</FieldError>
            )}
          </CardContent>
          <CardFooter className="justify-end gap-2 border-t pt-4">
            <Button type="button" variant="ghost" size="sm" onClick={() => setStep("providers")}>
              <ArrowLeftIcon className="size-3.5" />
              <span>Back</span>
            </Button>
            {skipButton}
            <Button
              type="button"
              size="sm"
              disabled={effectiveDefaultModel === null}
              onClick={() => {
                setSelectedModel(effectiveDefaultModel);
                setStep("profile");
              }}
            >
              Next: Create a profile
            </Button>
          </CardFooter>
        </Card>
      </OnboardingPage>
    );
  }

  return (
    <OnboardingPage>
      <Card className="w-full max-w-xl">
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
              "1. Connect model providers"
            )}
          </CardTitle>
          <CardDescription>
            {activeProvider !== undefined
              ? "Credentials are stored by the daemon and injected through the LLM proxy."
              : "Connect at least one LLM provider. You can add more providers anytime in Settings."}
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
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Providers</span>
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
                              <div className="text-xs text-muted-foreground">{item.oauthLabel}</div>
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
          )}

          {completeMutation.error !== null && (
            <FieldError>{completeMutation.error.message}</FieldError>
          )}
        </CardContent>

        <CardFooter className="justify-between border-t pt-4">
          {skipButton}
          <Button
            type="button"
            size="sm"
            disabled={activeProvider !== undefined || models.length === 0}
            onClick={() => setStep("model")}
          >
            Next: Choose a default model
          </Button>
        </CardFooter>
      </Card>
    </OnboardingPage>
  );
}
