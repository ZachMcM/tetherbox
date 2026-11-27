import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  formatSecretInjection,
  hostnameSchema,
  oauthScopeModeSchema,
  secretKeySchema,
  type LlmOAuthFlowEvent,
  type LlmOAuthFlowState,
  type LlmProvider,
  type LlmProviderStatus,
  type OAuthPresetId,
  type OAuthPresetSummary,
  type OAuthScopeMode,
  type OAuthStatusEntry,
  type SecretBinding,
  type SecretKey,
  type SecretListEntry,
  type StarterConfig,
  type StarterSecret,
} from "@tetherbox/core/app";
import { CheckCircle2Icon, CheckIcon, CopyIcon, ExternalLinkIcon, Trash2Icon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@tetherbox/ui/components/alert";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@tetherbox/ui/components/native-select";
import { Separator } from "@tetherbox/ui/components/separator";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { toast } from "@tetherbox/ui/components/toast";
import { appClient, expectOk, queryKeys, unwrapJson } from "../lib/api.ts";
import { openAuthWindow } from "../lib/auth-window.ts";
import { invalidateSecretQueries } from "../lib/queries.ts";

function defaultLlmKey(provider: LlmProvider): SecretKey {
  return secretKeySchema.parse(`${provider.toUpperCase().replaceAll("-", "_")}_API_KEY`);
}

export function findProviderApiKey(
  secrets: readonly SecretListEntry[],
  provider: LlmProvider,
): SecretKey | undefined {
  return secrets.find(
    (entry) => entry.binding.kind === "llm" && entry.binding.provider === provider,
  )?.key;
}

export function isProviderConnected(provider: LlmProviderStatus): boolean {
  return provider.hasApiKey || provider.oauthExpires !== undefined;
}

type PresetLogin = Extract<OAuthStatusEntry, { kind: "preset" }>;

export function findPresetLogin(
  logins: readonly OAuthStatusEntry[],
  presetId: OAuthPresetId,
): PresetLogin | undefined {
  return logins.find(
    (entry): entry is PresetLogin => entry.kind === "preset" && entry.preset === presetId,
  );
}

export function describePresetLogin(
  preset: OAuthPresetSummary,
  login: PresetLogin | undefined,
): string {
  return login !== undefined
    ? `${preset.secretKey} · ${login.scopeMode} · expires ${login.expires}`
    : `${preset.secretKey} · ${preset.domains.join(", ")}`;
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4"
    >
      <span>{children}</span>
      <ExternalLinkIcon className="size-3.5" />
    </a>
  );
}

export function AuthorizationPendingAlert({ url }: { url: string }) {
  return (
    <Alert>
      <AlertTitle>Finish authorization in the new tab</AlertTitle>
      <AlertDescription className="space-y-1.5">
        <p>Return here once the callback completes to continue.</p>
        <ExternalLink href={url}>Open authorization link</ExternalLink>
      </AlertDescription>
    </Alert>
  );
}

type ActiveFlow = LlmOAuthFlowState & { status: "pending" | "waiting_input" };

function isActiveFlow(flow: LlmOAuthFlowState | null): flow is ActiveFlow {
  return flow !== null && (flow.status === "pending" || flow.status === "waiting_input");
}

function latestAuthUrl(events: readonly LlmOAuthFlowEvent[]): string | undefined {
  return events.findLast((event) => event.kind === "auth_url")?.url;
}

export function describeSecretBinding(binding: SecretBinding): string {
  switch (binding.kind) {
    case "daemon":
      return "Daemon-only";
    case "llm":
      return `LLM provider: ${binding.provider}`;
    case "proxy":
      return `${binding.domains.join(", ")} (${formatSecretInjection(binding.inject)})`;
    default: {
      const exhaustive: never = binding;

      return exhaustive;
    }
  }
}

export function LlmProviderAuthPanel({
  provider,
  boundApiKey,
}: {
  provider: LlmProviderStatus;
  boundApiKey: SecretKey | undefined;
}) {
  const supportsApiKey = provider.supportedAuth.includes("api-key");
  const supportsOAuth = provider.supportedAuth.includes("oauth");

  return (
    <div className="space-y-5">
      {supportsApiKey && <LlmApiKeyForm provider={provider.provider} boundApiKey={boundApiKey} />}
      {supportsApiKey && supportsOAuth && <Separator />}
      {supportsOAuth && <LlmOAuthFlowPanel provider={provider} />}
    </div>
  );
}

function LlmApiKeyForm({
  provider,
  boundApiKey,
}: {
  provider: LlmProvider;
  boundApiKey: SecretKey | undefined;
}) {
  const queryClient = useQueryClient();
  const [apiKeyValue, setApiKeyValue] = useState("");
  const targetApiKeyName = boundApiKey ?? defaultLlmKey(provider);

  const invalidate = () => invalidateSecretQueries(queryClient);

  const saveMutation = useMutation({
    mutationFn: async () =>
      unwrapJson(
        await appClient.secrets[":key"].$put({
          param: { key: targetApiKeyName },
          json: {
            value: apiKeyValue.trim(),
            binding: { kind: "llm", provider },
          },
        }),
      ),
    onSuccess: () => {
      setApiKeyValue("");
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (key: SecretKey) => {
      await expectOk(await appClient.secrets[":key"].$delete({ param: { key } }));
    },
    onSuccess: invalidate,
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (apiKeyValue.trim() !== "") {
      saveMutation.mutate();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">API key</h3>
        {boundApiKey !== undefined && (
          <Button
            type="button"
            variant="destructive-outline"
            size="xs"
            disabled={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate(boundApiKey)}
          >
            <Trash2Icon className="size-3.5" />
            <span>Remove</span>
          </Button>
        )}
      </div>
      <Field>
        <FieldLabel
          htmlFor={`llm-api-key-${provider}`}
          className="text-xs font-normal text-muted-foreground"
        >
          <span>Secret key</span>
          <code className="font-mono text-xs text-foreground/80">{targetApiKeyName}</code>
        </FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id={`llm-api-key-${provider}`}
            type="password"
            placeholder={boundApiKey !== undefined ? "Enter new key to replace" : "Paste API key"}
            value={apiKeyValue}
            onChange={(event) => setApiKeyValue(event.target.value)}
          />
          <Button type="submit" disabled={saveMutation.isPending || apiKeyValue.trim() === ""}>
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
        <FieldDescription className="text-xs">
          Stored write-only under <code>{targetApiKeyName}</code> bound to <code>{provider}</code>.
        </FieldDescription>
      </Field>
      {saveMutation.error !== null && <FieldError>{saveMutation.error.message}</FieldError>}
      {deleteMutation.error !== null && <FieldError>{deleteMutation.error.message}</FieldError>}
    </form>
  );
}

function LlmOAuthFlowPanel({ provider }: { provider: LlmProviderStatus }) {
  const queryClient = useQueryClient();
  const [flow, setFlow] = useState<LlmOAuthFlowState | null>(null);
  const [promptInput, setPromptInput] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);
  const openedUrlRef = useRef<string | null>(null);
  const handledFlowIdRef = useRef<string | null>(null);
  const activeFlowIdRef = useRef<string | undefined>(undefined);
  const mountedRef = useRef(true);
  const providerLabel = provider.oauthLabel ?? provider.provider;

  const startOAuthMutation = useMutation({
    mutationFn: async () =>
      unwrapJson(
        await appClient.llm.oauth[":provider"].start.$post({
          param: { provider: provider.provider },
        }),
      ),
    onSuccess: (data) => {
      if (!mountedRef.current) {
        void appClient.llm.oauth.flows[":flowId"].cancel.$post({ param: { flowId: data.flow.id } });

        return;
      }

      setPromptInput("");
      setCopiedCode(false);
      setFlow(data.flow);
    },
    onError: (error) => {
      toast.add({
        type: "error",
        title: `Could not start ${providerLabel} sign-in`,
        description: error.message,
      });
    },
  });

  const respondOAuthMutation = useMutation({
    mutationFn: async ({ flowId, value }: { flowId: string; value: string }) =>
      unwrapJson(
        await appClient.llm.oauth.flows[":flowId"].respond.$post({
          param: { flowId },
          json: { value },
        }),
      ),
    onSuccess: (data) => {
      setPromptInput("");
      setFlow(data.flow);
    },
  });

  const cancelOAuthMutation = useMutation({
    mutationFn: async (flowId: string) =>
      unwrapJson(
        await appClient.llm.oauth.flows[":flowId"].cancel.$post({
          param: { flowId },
        }),
      ),
    onSuccess: () => {
      setFlow(null);
      setPromptInput("");
    },
  });

  const logoutOAuthMutation = useMutation({
    mutationFn: async () => {
      await expectOk(
        await appClient.llm.oauth[":provider"].$delete({
          param: { provider: provider.provider },
        }),
      );
    },
    onSuccess: () => {
      setFlow(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.llmStatus });
      void queryClient.invalidateQueries({ queryKey: queryKeys.llmModels });
      toast.add({
        type: "success",
        title: `${providerLabel} disconnected`,
      });
    },
    onError: (error) => {
      toast.add({
        type: "error",
        title: `Could not disconnect ${providerLabel}`,
        description: error.message,
      });
    },
  });

  const activeFlow = isActiveFlow(flow) ? flow : null;
  const activeFlowId = activeFlow?.id;
  const authUrl = activeFlow !== null ? latestAuthUrl(activeFlow.events) : undefined;
  const deviceCodeEvent = activeFlow?.events.findLast((event) => event.kind === "device_code");

  useEffect(() => {
    activeFlowIdRef.current = activeFlowId;
  }, [activeFlowId]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      const pendingId = activeFlowIdRef.current;

      if (pendingId !== undefined) {
        void appClient.llm.oauth.flows[":flowId"].cancel.$post({ param: { flowId: pendingId } });
      }
    };
  }, []);

  useEffect(() => {
    if (activeFlowId === undefined) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const result = await unwrapJson(
          await appClient.llm.oauth.flows[":flowId"].$get({ param: { flowId: activeFlowId } }),
        );

        if (!cancelled) {
          setFlow(result.flow);
        }
      } catch {
        // Keep the latest state if a single poll fails transiently.
      }
    };

    const timer = setInterval(() => {
      void poll();
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeFlowId]);

  useEffect(() => {
    if (authUrl !== undefined && openedUrlRef.current !== authUrl) {
      openedUrlRef.current = authUrl;
      openAuthWindow(authUrl);
    }
  }, [authUrl]);

  useEffect(() => {
    if (flow === null || isActiveFlow(flow) || handledFlowIdRef.current === flow.id) {
      return;
    }

    handledFlowIdRef.current = flow.id;

    if (flow.status === "completed") {
      void queryClient.invalidateQueries({ queryKey: queryKeys.llmStatus });
      void queryClient.invalidateQueries({ queryKey: queryKeys.llmModels });
      toast.add({
        type: "success",
        title: `${providerLabel} connected`,
        description: "OAuth credentials saved.",
      });
    } else if (flow.status === "failed") {
      toast.add({
        type: "error",
        title: `${providerLabel} sign-in failed`,
        description: flow.error,
      });
    }

    setFlow(null);
    setPromptInput("");
  }, [flow, providerLabel, queryClient]);

  const connectionStatus =
    provider.oauthExpires !== undefined
      ? `Connected · expires ${provider.oauthExpires}`
      : "Not connected";
  const connectLabel = provider.oauthExpires !== undefined ? "Reconnect" : "Connect";

  const handlePromptSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (activeFlow !== null && promptInput.trim() !== "") {
      respondOAuthMutation.mutate({ flowId: activeFlow.id, value: promptInput.trim() });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">
            OAuth{provider.oauthLabel !== undefined ? ` (${provider.oauthLabel})` : ""}
          </h3>
          <div className="text-xs text-muted-foreground">
            {activeFlow !== null ? "Waiting for sign-in…" : connectionStatus}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeFlow !== null ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={cancelOAuthMutation.isPending}
              onClick={() => cancelOAuthMutation.mutate(activeFlow.id)}
            >
              Cancel
            </Button>
          ) : (
            <>
              {provider.oauthExpires !== undefined && (
                <Button
                  type="button"
                  variant="destructive-outline"
                  size="xs"
                  disabled={logoutOAuthMutation.isPending}
                  onClick={() => logoutOAuthMutation.mutate()}
                >
                  Disconnect
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={startOAuthMutation.isPending}
                onClick={() => startOAuthMutation.mutate()}
              >
                {startOAuthMutation.isPending ? "Starting…" : connectLabel}
              </Button>
            </>
          )}
        </div>
      </div>

      {activeFlow !== null && (
        <div className="space-y-3">
          {deviceCodeEvent !== undefined ? (
            <div className="space-y-2 text-xs">
              <p className="text-muted-foreground">
                Open the verification page and enter this code to finish signing in:
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-muted px-2 py-1 font-mono text-sm font-semibold tracking-wider">
                  {deviceCodeEvent.userCode}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    void navigator.clipboard.writeText(deviceCodeEvent.userCode).then(() => {
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 1500);
                    });
                  }}
                >
                  {copiedCode ? (
                    <CheckIcon className="size-3.5" />
                  ) : (
                    <CopyIcon className="size-3.5" />
                  )}
                  <span>{copiedCode ? "Copied" : "Copy"}</span>
                </Button>
                <ExternalLink href={deviceCodeEvent.verificationUri}>
                  Open verification page
                </ExternalLink>
              </div>
            </div>
          ) : activeFlow.status === "waiting_input" && activeFlow.prompt.kind === "text" ? (
            <div className="space-y-2.5">
              {authUrl !== undefined && (
                <ExternalLink href={authUrl}>Open sign-in page</ExternalLink>
              )}
              <form onSubmit={handlePromptSubmit}>
                <Field>
                  <FieldLabel
                    htmlFor={`oauth-prompt-${provider.provider}`}
                    className="text-xs font-normal text-muted-foreground"
                  >
                    {activeFlow.prompt.message}
                  </FieldLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`oauth-prompt-${provider.provider}`}
                      placeholder={activeFlow.prompt.placeholder}
                      value={promptInput}
                      onChange={(event) => setPromptInput(event.target.value)}
                      required
                    />
                    <Button
                      type="submit"
                      disabled={respondOAuthMutation.isPending || promptInput.trim() === ""}
                    >
                      Submit
                    </Button>
                  </div>
                </Field>
              </form>
            </div>
          ) : activeFlow.status === "waiting_input" && activeFlow.prompt.kind === "select" ? (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">{activeFlow.prompt.message}</div>
              <div className="space-y-1.5">
                {activeFlow.prompt.options.map((option) => (
                  <Button
                    key={option.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto w-full flex-col items-start py-2 text-left"
                    disabled={respondOAuthMutation.isPending}
                    onClick={() =>
                      respondOAuthMutation.mutate({ flowId: activeFlow.id, value: option.id })
                    }
                  >
                    <span>{option.label}</span>
                    {option.description !== undefined && (
                      <span className="text-xs font-normal text-muted-foreground">
                        {option.description}
                      </span>
                    )}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <Spinner className="size-3.5" />
              <span>
                {authUrl !== undefined
                  ? "Complete sign-in in the browser tab."
                  : "Starting sign-in…"}
              </span>
              {authUrl !== undefined && (
                <ExternalLink href={authUrl}>Open sign-in page</ExternalLink>
              )}
            </div>
          )}

          {respondOAuthMutation.error !== null && (
            <FieldError>{respondOAuthMutation.error.message}</FieldError>
          )}
        </div>
      )}
    </div>
  );
}

export function OAuthPresetCredentialsForm({
  preset,
  onSaved,
}: {
  preset: OAuthPresetSummary;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      await unwrapJson(
        await appClient.secrets[":key"].$put({
          param: { key: preset.clientIdSecretKey },
          json: { value: clientId.trim(), binding: { kind: "daemon" } },
        }),
      );
      await unwrapJson(
        await appClient.secrets[":key"].$put({
          param: { key: preset.clientSecretSecretKey },
          json: { value: clientSecret.trim(), binding: { kind: "daemon" } },
        }),
      );
    },
    onSuccess: () => {
      setClientId("");
      setClientSecret("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.oauthStatus });
      void queryClient.invalidateQueries({ queryKey: queryKeys.secrets });
      onSaved?.();
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Register <code>{`${window.location.origin}/api/oauth/callback`}</code> as an authorized
        redirect URI, then save your OAuth client ID and secret.
      </p>
      <Field>
        <FieldLabel
          htmlFor={`oauth-cid-${preset.id}`}
          className="text-xs font-normal text-muted-foreground"
        >
          <span>Client ID</span>
          <code className="font-mono text-xs text-foreground/80">{preset.clientIdSecretKey}</code>
        </FieldLabel>
        <Input
          id={`oauth-cid-${preset.id}`}
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          required
        />
      </Field>
      <Field>
        <FieldLabel
          htmlFor={`oauth-csec-${preset.id}`}
          className="text-xs font-normal text-muted-foreground"
        >
          <span>Client secret</span>
          <code className="font-mono text-xs text-foreground/80">
            {preset.clientSecretSecretKey}
          </code>
        </FieldLabel>
        <Input
          id={`oauth-csec-${preset.id}`}
          type="password"
          value={clientSecret}
          onChange={(event) => setClientSecret(event.target.value)}
          required
        />
      </Field>
      {mutation.error !== null && <FieldError>{mutation.error.message}</FieldError>}
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          disabled={mutation.isPending || clientId.trim() === "" || clientSecret.trim() === ""}
        >
          {mutation.isPending ? "Saving…" : "Save client credentials"}
        </Button>
      </div>
    </form>
  );
}

export function OAuthPresetConnectForm({ preset }: { preset: OAuthPresetSummary }) {
  const [scopeMode, setScopeMode] = useState<OAuthScopeMode>(preset.defaultScopeMode);
  const [authUrl, setAuthUrl] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () =>
      unwrapJson(
        await appClient.oauth.presets[":preset"].start.$post({
          param: { preset: preset.id },
          json: { scopeMode },
        }),
      ),
    onSuccess: (data) => {
      setAuthUrl(data.authorizationUrl);
      openAuthWindow(data.authorizationUrl);
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  const authorizeLabel = authUrl !== null ? "Reopen" : "Authorize";

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex items-end gap-2">
        <Field className="flex-1">
          <FieldLabel
            htmlFor={`preset-scope-${preset.id}`}
            className="text-xs font-normal text-muted-foreground"
          >
            Permission level
          </FieldLabel>
          <NativeSelect
            id={`preset-scope-${preset.id}`}
            className="w-full"
            value={scopeMode}
            onChange={(event) => {
              const parsed = oauthScopeModeSchema.safeParse(event.target.value);

              if (parsed.success) {
                setScopeMode(parsed.data);
              }
            }}
          >
            <NativeSelectOption value="read-only">Read-only</NativeSelectOption>
            <NativeSelectOption value="read-write">Read and write</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Starting…" : authorizeLabel}
        </Button>
      </div>

      {authUrl !== null && <AuthorizationPendingAlert url={authUrl} />}

      {mutation.error !== null && <FieldError>{mutation.error.message}</FieldError>}
    </form>
  );
}

function domainFromStarterConfig(
  starterConfig: StarterConfig,
  ref: { readonly starterId: string; readonly key: string } | undefined,
): string {
  if (ref === undefined) {
    return "";
  }

  const rawUrl = starterConfig[ref.starterId]?.[ref.key];

  if (rawUrl === undefined) {
    return "";
  }

  const parsed = URL.parse(rawUrl);

  if (parsed === null) {
    return "";
  }

  const host = parsed.hostname.toLowerCase();

  return hostnameSchema.safeParse(host).success ? host : "";
}

function describeStarterSecretBinding(secret: StarterSecret, derivedDomain: string): string {
  if (secret.kind === "fixed") {
    return describeSecretBinding(secret.binding);
  }

  const hostLabel = derivedDomain !== "" ? derivedDomain : secret.domainPlaceholder;

  return `${hostLabel} (${formatSecretInjection(secret.inject)})`;
}

type SecretValueBinding = SecretBinding | { kind: "invalid"; message: string };

export function SecretValueForm({
  secretKey,
  binding,
  children,
}: {
  secretKey: SecretKey;
  binding: SecretValueBinding;
  children?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const inputId = useId();
  const [value, setValue] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (nextBinding: SecretBinding) =>
      unwrapJson(
        await appClient.secrets[":key"].$put({
          param: { key: secretKey },
          json: { value: value.trim(), binding: nextBinding },
        }),
      ),
    onSuccess: () => {
      setValue("");
      invalidateSecretQueries(queryClient);
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (value.trim() === "") {
      setValidationError("Enter a secret value.");

      return;
    }

    if (binding.kind === "invalid") {
      setValidationError(binding.message);

      return;
    }

    setValidationError(null);
    mutation.mutate(binding);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2.5">
      {children}
      <Field>
        <FieldLabel htmlFor={inputId} className="text-xs font-normal text-muted-foreground">
          Value
        </FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id={inputId}
            type="password"
            placeholder={`Paste ${secretKey}`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoComplete="off"
            required
          />
          <Button type="submit" size="sm" disabled={mutation.isPending || value.trim() === ""}>
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </Field>
      {validationError !== null && <FieldError>{validationError}</FieldError>}
      {mutation.error !== null && <FieldError>{mutation.error.message}</FieldError>}
    </form>
  );
}

function starterSecretBinding(secret: StarterSecret, domain: string): SecretValueBinding {
  if (secret.kind === "fixed") {
    return secret.binding;
  }

  const normalized = domain.trim().toLowerCase();

  return hostnameSchema.safeParse(normalized).success
    ? { kind: "proxy", domains: [normalized], inject: secret.inject }
    : { kind: "invalid", message: "Enter a valid hostname without scheme or path." };
}

export function StarterSecretInlineCard({
  secret,
  starterConfig,
  isConfigured,
}: {
  secret: StarterSecret;
  starterConfig: StarterConfig;
  isConfigured: boolean;
}) {
  const derivedDomain =
    secret.kind === "prompt-domain"
      ? domainFromStarterConfig(starterConfig, secret.fromConfigUrl)
      : "";
  const [customDomain, setCustomDomain] = useState<string | null>(null);
  const domain = customDomain ?? derivedDomain;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold">{secret.key}</span>
            <Badge variant="secondary" className="text-[10px] font-normal">
              VM-wide
            </Badge>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {describeStarterSecretBinding(secret, domain)}
          </div>
        </div>
        {isConfigured ? (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2Icon className="size-3" />
            <span>Saved</span>
          </Badge>
        ) : (
          <Badge variant="outline">Missing</Badge>
        )}
      </div>

      {!isConfigured && (
        <SecretValueForm secretKey={secret.key} binding={starterSecretBinding(secret, domain)}>
          {secret.kind === "prompt-domain" && (
            <Field>
              <FieldLabel
                htmlFor={`wizard-domain-${secret.key}`}
                className="text-xs font-normal text-muted-foreground"
              >
                {secret.domainPrompt}
              </FieldLabel>
              <Input
                id={`wizard-domain-${secret.key}`}
                placeholder={secret.domainPlaceholder}
                value={domain}
                onChange={(event) => setCustomDomain(event.target.value)}
                required
              />
            </Field>
          )}
        </SecretValueForm>
      )}
    </div>
  );
}

export function OAuthPresetInlineCard({
  preset,
  activeLogin,
}: {
  preset: OAuthPresetSummary;
  activeLogin?: PresetLogin | undefined;
}) {
  const connected = activeLogin !== undefined;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold">{preset.label} OAuth</span>
            <Badge variant="secondary" className="text-[10px] font-normal">
              VM-wide
            </Badge>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {describePresetLogin(preset, activeLogin)}
          </div>
        </div>
        {connected ? (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2Icon className="size-3" />
            <span>Connected</span>
          </Badge>
        ) : (
          <Badge variant="outline">
            {preset.hasClientCredentials ? "Not connected" : "Needs client secret"}
          </Badge>
        )}
      </div>

      {!connected &&
        (preset.hasClientCredentials ? (
          <OAuthPresetConnectForm preset={preset} />
        ) : (
          <OAuthPresetCredentialsForm preset={preset} />
        ))}
    </div>
  );
}
