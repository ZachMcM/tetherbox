import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customOAuthLoginSchema,
  secretKeySchema,
  type CustomOAuthLoginInput,
  type OAuthPresetSummary,
} from "@tetherbox/core/app";
import { PlusIcon, RefreshCwIcon } from "lucide-react";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { appClient, expectOk, queryKeys, unwrapJson } from "../../lib/api.ts";
import { openAuthWindow } from "../../lib/auth-window.ts";
import { parseDomainsList, splitList } from "../../lib/lists.ts";
import { oauthStatusQueryOptions } from "../../lib/queries.ts";
import {
  AuthorizationPendingAlert,
  describePresetLogin,
  findPresetLogin,
  OAuthPresetConnectForm,
  OAuthPresetCredentialsForm,
} from "../auth-setup-panels.tsx";
import { SectionHeader, SettingGroup, SettingRow } from "./shared.tsx";

type IntegrationSubView =
  | { kind: "credentials"; preset: OAuthPresetSummary }
  | { kind: "connect"; preset: OAuthPresetSummary }
  | { kind: "custom" };

function CustomOAuthView({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [secretKey, setSecretKey] = useState("");
  const [authorizationUrl, setAuthorizationUrl] = useState("");
  const [tokenUrl, setTokenUrl] = useState("");
  const [domainsText, setDomainsText] = useState("");
  const [scopesText, setScopesText] = useState("");
  const [clientIdSecretKey, setClientIdSecretKey] = useState("");
  const [clientIdValue, setClientIdValue] = useState("");
  const [clientSecretSecretKey, setClientSecretSecretKey] = useState("");
  const [clientSecretValue, setClientSecretValue] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (input: {
      payload: CustomOAuthLoginInput;
      clientIdSecret?: { key: string; value: string };
      clientSecret?: { key: string; value: string };
    }) => {
      if (input.clientIdSecret !== undefined) {
        await unwrapJson(
          await appClient.secrets[":key"].$put({
            param: { key: input.clientIdSecret.key },
            json: { value: input.clientIdSecret.value, binding: { kind: "daemon" } },
          }),
        );
      }

      if (input.clientSecret !== undefined) {
        await unwrapJson(
          await appClient.secrets[":key"].$put({
            param: { key: input.clientSecret.key },
            json: { value: input.clientSecret.value, binding: { kind: "daemon" } },
          }),
        );
      }

      return unwrapJson(await appClient.oauth.custom.start.$post({ json: input.payload }));
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.secrets });
      setAuthUrl(data.authorizationUrl);
      openAuthWindow(data.authorizationUrl);
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    const parsedSecretKey = secretKeySchema.safeParse(secretKey.trim().toUpperCase());

    if (!parsedSecretKey.success) {
      setValidationError("Enter a valid secret key (for example SPOTIFY_OAUTH).");

      return;
    }

    const effectiveClientIdKeyRaw =
      clientIdSecretKey.trim() !== ""
        ? clientIdSecretKey.trim().toUpperCase()
        : `${parsedSecretKey.data}_CLIENT_ID`;
    const parsedClientIdKey = secretKeySchema.safeParse(effectiveClientIdKeyRaw);

    if (!parsedClientIdKey.success) {
      setValidationError("Enter a valid client ID secret key.");

      return;
    }

    let parsedClientSecretKey: string | undefined;

    if (clientSecretSecretKey.trim() !== "" || clientSecretValue.trim() !== "") {
      const rawKey =
        clientSecretSecretKey.trim() !== ""
          ? clientSecretSecretKey.trim().toUpperCase()
          : `${parsedSecretKey.data}_CLIENT_SECRET`;
      const parsed = secretKeySchema.safeParse(rawKey);

      if (!parsed.success) {
        setValidationError("Enter a valid client secret key.");

        return;
      }

      parsedClientSecretKey = parsed.data;
    }

    const parsedDomains = parseDomainsList(domainsText);

    if (!parsedDomains.ok) {
      setValidationError(parsedDomains.error);

      return;
    }

    const scopes = splitList(scopesText);

    if (scopes.length === 0) {
      setValidationError("Enter at least one OAuth scope.");

      return;
    }

    const parsedPayload = customOAuthLoginSchema.safeParse({
      secretKey: parsedSecretKey.data,
      authorizationUrl: authorizationUrl.trim(),
      tokenUrl: tokenUrl.trim(),
      domains: parsedDomains.domains,
      scopes,
      clientIdSecretKey: parsedClientIdKey.data,
      ...(parsedClientSecretKey !== undefined
        ? { clientSecretSecretKey: parsedClientSecretKey }
        : {}),
    });

    if (!parsedPayload.success) {
      setValidationError(parsedPayload.error.issues[0]?.message ?? "Invalid OAuth settings.");

      return;
    }

    setValidationError(null);
    mutation.mutate({
      payload: parsedPayload.data,
      ...(clientIdValue.trim() !== ""
        ? { clientIdSecret: { key: parsedClientIdKey.data, value: clientIdValue.trim() } }
        : {}),
      ...(parsedClientSecretKey !== undefined && clientSecretValue.trim() !== ""
        ? { clientSecret: { key: parsedClientSecretKey, value: clientSecretValue.trim() } }
        : {}),
    });
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        onBack={onClose}
        title="Add custom OAuth2 integration"
        description={`Register ${window.location.origin}/api/oauth/callback as the redirect URI with your provider.`}
      />

      <form onSubmit={handleSubmit} className="space-y-3">
        <Field>
          <FieldLabel htmlFor="custom-oauth-key">Token secret key</FieldLabel>
          <Input
            id="custom-oauth-key"
            placeholder="SPOTIFY_OAUTH"
            value={secretKey}
            onChange={(event) => setSecretKey(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="custom-oauth-auth-url">Authorization URL</FieldLabel>
          <Input
            id="custom-oauth-auth-url"
            placeholder="https://accounts.example.com/authorize"
            value={authorizationUrl}
            onChange={(event) => setAuthorizationUrl(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="custom-oauth-token-url">Token URL</FieldLabel>
          <Input
            id="custom-oauth-token-url"
            placeholder="https://accounts.example.com/token"
            value={tokenUrl}
            onChange={(event) => setTokenUrl(event.target.value)}
            required
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="custom-oauth-domains">Pinned API domains</FieldLabel>
            <Input
              id="custom-oauth-domains"
              placeholder="api.example.com"
              value={domainsText}
              onChange={(event) => setDomainsText(event.target.value)}
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="custom-oauth-scopes">Scopes</FieldLabel>
            <Input
              id="custom-oauth-scopes"
              placeholder="read write"
              value={scopesText}
              onChange={(event) => setScopesText(event.target.value)}
              required
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="custom-oauth-cid-key">Client ID secret key</FieldLabel>
            <Input
              id="custom-oauth-cid-key"
              placeholder="Defaults to <KEY>_CLIENT_ID"
              value={clientIdSecretKey}
              onChange={(event) => setClientIdSecretKey(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="custom-oauth-cid-val">Client ID value (optional)</FieldLabel>
            <Input
              id="custom-oauth-cid-val"
              placeholder="Leave blank if already stored"
              value={clientIdValue}
              onChange={(event) => setClientIdValue(event.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="custom-oauth-csec-key">Client secret key (optional)</FieldLabel>
            <Input
              id="custom-oauth-csec-key"
              placeholder="<KEY>_CLIENT_SECRET"
              value={clientSecretSecretKey}
              onChange={(event) => setClientSecretSecretKey(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="custom-oauth-csec-val">Client secret value (optional)</FieldLabel>
            <Input
              id="custom-oauth-csec-val"
              type="password"
              placeholder="Leave blank if already stored"
              value={clientSecretValue}
              onChange={(event) => setClientSecretValue(event.target.value)}
            />
          </Field>
        </div>
        <FieldDescription>
          Provide values above to store them as daemon secrets before redirecting.
        </FieldDescription>

        {authUrl !== null && <AuthorizationPendingAlert url={authUrl} />}

        {validationError !== null && <FieldError>{validationError}</FieldError>}
        {mutation.error !== null && <FieldError>{mutation.error.message}</FieldError>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {authUrl !== null ? "Done" : "Cancel"}
          </Button>
          <Button type="submit" size="sm" disabled={mutation.isPending}>
            {mutation.isPending ? "Starting…" : "Authorize"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function IntegrationsSection() {
  const queryClient = useQueryClient();
  const [subView, setSubView] = useState<IntegrationSubView | null>(null);

  const oauthQuery = useQuery({
    ...oauthStatusQueryOptions,
    refetchOnWindowFocus: "always",
  });

  const logoutMutation = useMutation({
    mutationFn: async (target: string) => {
      await expectOk(await appClient.oauth[":target"].$delete({ param: { target } }));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.oauthStatus });
    },
  });

  const closeSubView = () => {
    setSubView(null);
    void queryClient.invalidateQueries({ queryKey: queryKeys.oauthStatus });
  };

  if (subView !== null) {
    if (subView.kind === "custom") {
      return <CustomOAuthView onClose={closeSubView} />;
    }

    const { preset } = subView;

    return (
      <div className="space-y-6">
        <SectionHeader
          onBack={closeSubView}
          title={
            subView.kind === "credentials"
              ? `${preset.label} OAuth client credentials`
              : `Connect ${preset.label}`
          }
          description={
            subView.kind === "credentials"
              ? "Store the OAuth app client ID and secret in the daemon before connecting."
              : `Stores a refreshing token under ${preset.secretKey} pinned to ${preset.domains.join(", ")}.`
          }
        />

        {subView.kind === "credentials" ? (
          <OAuthPresetCredentialsForm
            preset={preset}
            onSaved={() => setSubView({ kind: "connect", preset })}
          />
        ) : (
          <OAuthPresetConnectForm preset={preset} />
        )}
      </div>
    );
  }

  const presets = oauthQuery.data?.presets ?? [];
  const logins = oauthQuery.data?.logins ?? [];
  const customLogins = logins.filter((entry) => entry.kind === "custom");

  let presetContent = (
    <>
      {presets.map((preset) => {
        const activeLogin = findPresetLogin(logins, preset.id);

        return (
          <SettingRow
            key={preset.id}
            title={preset.label}
            description={describePresetLogin(preset, activeLogin)}
            control={
              <div className="flex items-center gap-2">
                {activeLogin !== undefined ? (
                  <Badge variant="secondary">connected</Badge>
                ) : (
                  <Badge variant={preset.hasClientCredentials ? "secondary" : "outline"}>
                    {preset.hasClientCredentials ? "ready" : "needs client secret"}
                  </Badge>
                )}
                {!preset.hasClientCredentials ? (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => setSubView({ kind: "credentials", preset })}
                  >
                    Set credentials
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setSubView({ kind: "connect", preset })}
                    >
                      {activeLogin !== undefined ? "Reconnect" : "Connect"}
                    </Button>
                    {activeLogin !== undefined && (
                      <Button
                        variant="destructive-outline"
                        size="xs"
                        disabled={logoutMutation.isPending}
                        onClick={() => logoutMutation.mutate(preset.id)}
                      >
                        Disconnect
                      </Button>
                    )}
                  </>
                )}
              </div>
            }
          />
        );
      })}
    </>
  );

  if (oauthQuery.isPending) {
    presetContent = (
      <div className="flex justify-center p-6">
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    );
  } else if (oauthQuery.error !== null) {
    presetContent = (
      <div className="px-4 py-4 text-xs text-destructive">{oauthQuery.error.message}</div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Integrations"
        description={`Connected OAuth tokens managed by the daemon (${logins.length} active).`}
      />

      <SettingGroup
        title="OAuth presets"
        action={
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void oauthQuery.refetch()}
            disabled={oauthQuery.isFetching}
          >
            <RefreshCwIcon className="size-3.5" />
            <span>Refresh</span>
          </Button>
        }
      >
        {presetContent}
      </SettingGroup>

      <SettingGroup
        title="Custom OAuth2"
        action={
          <Button variant="outline" size="xs" onClick={() => setSubView({ kind: "custom" })}>
            <PlusIcon className="size-3.5" />
            <span>Add custom</span>
          </Button>
        }
      >
        {customLogins.length === 0 ? (
          <div className="px-4 py-4 text-xs text-muted-foreground">
            No custom OAuth2 integrations connected
          </div>
        ) : (
          customLogins.map((entry) => (
            <SettingRow
              key={entry.secretKey}
              title={entry.secretKey}
              description={`${entry.domains.join(", ")} · expires ${entry.expires}`}
              control={
                <Button
                  variant="destructive-outline"
                  size="xs"
                  disabled={logoutMutation.isPending}
                  onClick={() => logoutMutation.mutate(entry.secretKey)}
                >
                  Disconnect
                </Button>
              }
            />
          ))
        )}
      </SettingGroup>

      {logoutMutation.error !== null && <FieldError>{logoutMutation.error.message}</FieldError>}
    </div>
  );
}
