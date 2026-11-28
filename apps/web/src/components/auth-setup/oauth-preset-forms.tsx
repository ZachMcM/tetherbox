import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  oauthScopeModeSchema,
  type OAuthPresetSummary,
  type OAuthScopeMode,
} from "@tetherbox/core/app";
import { Button } from "@tetherbox/ui/components/button";
import { Field, FieldError, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@tetherbox/ui/components/native-select";
import { appClient, queryKeys, unwrapJson } from "../../lib/api.ts";
import { openAuthWindow } from "../../lib/auth-window.ts";
import { AuthorizationPendingAlert } from "./authorization-pending-alert.tsx";

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
