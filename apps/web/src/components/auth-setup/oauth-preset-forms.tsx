import { useId, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  oauthScopeModeSchema,
  type OAuthPresetSummary,
  type OAuthProviderId,
  type OAuthScopeMode,
} from "@tetherbox/core/app";
import { Button } from "@tetherbox/ui/components/button";
import { CodeBlockCopyButton } from "@tetherbox/ui/components/code-block";
import { Field, FieldError, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@tetherbox/ui/components/input-group";
import { NativeSelect, NativeSelectOption } from "@tetherbox/ui/components/native-select";
import { appClient, queryKeys, unwrapJson } from "../../lib/api.ts";
import { openAuthWindow } from "../../lib/auth-window.ts";
import { AuthorizationPendingAlert } from "./authorization-pending-alert.tsx";
import { ExternalLink } from "./external-link.tsx";

export const OAUTH_PROVIDER_LABELS: Readonly<Record<OAuthProviderId, string>> = {
  google: "Google",
};

const OAUTH_PROVIDER_SETUP_DOCS: Readonly<Record<OAuthProviderId, { label: string; url: string }>> =
  {
    google: {
      label: "How to create a Google OAuth client",
      url: "https://developers.google.com/workspace/guides/create-credentials#oauth-client-id",
    },
  };

export function OAuthRedirectUriField() {
  const inputId = useId();
  const redirectUri = `${window.location.origin}/api/oauth/callback`;

  return (
    <Field>
      <FieldLabel htmlFor={inputId} className="text-xs font-normal text-muted-foreground">
        Authorized redirect URI
      </FieldLabel>
      <InputGroup>
        <InputGroupInput
          id={inputId}
          value={redirectUri}
          readOnly
          className="font-mono text-xs text-muted-foreground"
          onFocus={(event) => event.currentTarget.select()}
        />
        <InputGroupAddon align="inline-end">
          <CodeBlockCopyButton value={redirectUri} />
        </InputGroupAddon>
      </InputGroup>
    </Field>
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

  const setupDocs = OAUTH_PROVIDER_SETUP_DOCS[preset.provider];

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Add this redirect URI to your OAuth client, then save the credentials below.</span>
        <ExternalLink href={setupDocs.url}>{setupDocs.label}</ExternalLink>
      </div>
      <OAuthRedirectUriField />
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
