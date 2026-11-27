import { useState } from "react";
import type { OAuthPresetSummary, StarterConfig, StarterSecret } from "@tetherbox/core/app";
import { CheckCircle2Icon } from "lucide-react";
import { Badge } from "@tetherbox/ui/components/badge";
import { Field, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import { describePresetLogin, type PresetLogin } from "../../lib/auth-status.ts";
import { OAuthPresetConnectForm, OAuthPresetCredentialsForm } from "./oauth-preset-forms.tsx";
import {
  describeStarterSecretBinding,
  domainFromStarterConfig,
  SecretValueForm,
  starterSecretBinding,
} from "./secret-value-form.tsx";

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
