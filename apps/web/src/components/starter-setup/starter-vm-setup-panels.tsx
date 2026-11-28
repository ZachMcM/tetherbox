import {
  type OAuthPresetSummary,
  type OAuthStatusEntry,
  type StarterConfig,
  type StarterSummary,
} from "@tetherbox/core/app";
import { OAuthPresetInlineCard, StarterSecretInlineCard } from "../auth-setup/inline-cards.tsx";
import { findPresetLogin } from "../../lib/auth-status.ts";
import { CliAuthFlowPanel } from "../cli-setup/cli-auth-flow-panel.tsx";
import { type CliInstallRunner } from "../cli-setup/use-cli-install-runner.ts";
import { type StarterReadiness } from "../../lib/starter-readiness.ts";

export function StarterVmSetupPanels({
  starter,
  readiness,
  starterConfig,
  oauthPresets,
  oauthLogins,
  installRunner,
  showAllClis = false,
}: {
  starter: StarterSummary;
  readiness: StarterReadiness | undefined;
  starterConfig: StarterConfig;
  oauthPresets: readonly OAuthPresetSummary[];
  oauthLogins: readonly OAuthStatusEntry[];
  installRunner: CliInstallRunner;
  showAllClis?: boolean;
}) {
  const missingSecretKeys = new Set(readiness?.missingSecrets.map((secret) => secret.key));
  const oauthPreset =
    starter.oauthPreset !== undefined
      ? oauthPresets.find((entry) => entry.id === starter.oauthPreset)
      : undefined;
  const oauthLogin =
    starter.oauthPreset !== undefined
      ? findPresetLogin(oauthLogins, starter.oauthPreset)
      : undefined;
  const showCliPanel =
    readiness?.cliEntry !== undefined &&
    (showAllClis || starter.cli?.hasAuth === true || readiness.cliEntry.status.kind === "error");

  return (
    <>
      {starter.secrets.map((secret) => (
        <StarterSecretInlineCard
          key={secret.key}
          secret={secret}
          starterConfig={starterConfig}
          isConfigured={readiness?.isStatusLoaded === true && !missingSecretKeys.has(secret.key)}
        />
      ))}

      {oauthPreset !== undefined && (
        <OAuthPresetInlineCard preset={oauthPreset} activeLogin={oauthLogin} />
      )}

      {showCliPanel && readiness?.cliEntry !== undefined && (
        <CliAuthFlowPanel entry={readiness.cliEntry} installRunner={installRunner} />
      )}

      {starter.setupNote !== undefined && (
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          {starter.setupNote}
        </p>
      )}
    </>
  );
}
