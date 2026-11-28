import { useState } from "react";
import {
  formatSecretInjection,
  hostnameSchema,
  type OAuthPresetSummary,
  type StarterConfig,
  type StarterSecret,
} from "@tetherbox/core/app";
import { Badge } from "@tetherbox/ui/components/badge";
import { StatusBadge } from "@tetherbox/ui/components/status-badge";
import { Field, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import {
  describePresetLogin,
  describeSecretBinding,
  type PresetLogin,
} from "../../lib/auth-status.ts";
import { OAuthPresetConnectForm, OAuthPresetCredentialsForm } from "./oauth-preset-forms.tsx";
import { SecretValueForm, type SecretValueBinding } from "./secret-value-form.tsx";

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
  showStatusBadge = true,
}: {
  secret: StarterSecret;
  starterConfig: StarterConfig;
  isConfigured: boolean;
  showStatusBadge?: boolean;
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
            <Badge variant="attribute">VM-wide</Badge>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {describeStarterSecretBinding(secret, domain)}
          </div>
        </div>
        {showStatusBadge &&
          (isConfigured ? (
            <StatusBadge status="success">Saved</StatusBadge>
          ) : (
            <StatusBadge status="attention">Missing</StatusBadge>
          ))}
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
  credentialsHandledExternally = false,
  showStatusBadge = true,
}: {
  preset: OAuthPresetSummary;
  activeLogin?: PresetLogin | undefined;
  credentialsHandledExternally?: boolean;
  showStatusBadge?: boolean;
}) {
  const connected = activeLogin !== undefined;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold">{preset.label} OAuth</span>
            <Badge variant="attribute">VM-wide</Badge>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {describePresetLogin(preset, activeLogin)}
          </div>
        </div>
        {showStatusBadge &&
          (connected ? (
            <StatusBadge status="success">Connected</StatusBadge>
          ) : (
            <StatusBadge status="attention">
              {preset.hasClientCredentials ? "Not connected" : "Needs client secret"}
            </StatusBadge>
          ))}
      </div>

      {!connected &&
        (preset.hasClientCredentials ? (
          <OAuthPresetConnectForm preset={preset} />
        ) : credentialsHandledExternally ? (
          <p className="text-xs text-muted-foreground">
            Save the shared OAuth client credentials above to authorize.
          </p>
        ) : (
          <OAuthPresetCredentialsForm preset={preset} />
        ))}
    </div>
  );
}
