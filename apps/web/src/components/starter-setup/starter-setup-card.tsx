import { useState } from "react";
import {
  type OAuthPresetSummary,
  type OAuthProviderId,
  type OAuthStatusEntry,
  type StarterConfig,
  type StarterSummary,
} from "@tetherbox/core/app";
import { AlertCircleIcon, CheckCircle2Icon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { Badge } from "@tetherbox/ui/components/badge";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { type CliInstallRunner } from "../cli-setup/use-cli-install-runner.ts";
import { StarterIcon } from "../starter-icons.tsx";
import { isStarterConfigValid, type StarterReadiness } from "../../lib/starter-readiness.ts";
import { StarterBadges } from "./starter-badges.tsx";
import { StarterConfigFields, type StarterConnectionState } from "./starter-config-fields.tsx";
import { StarterVmSetupPanels } from "./starter-vm-setup-panels.tsx";

function StarterSetupStatusBadge({
  readiness,
  starter,
  allReady,
  connectionState,
}: {
  readiness: StarterReadiness;
  starter: StarterSummary;
  allReady: boolean;
  connectionState: StarterConnectionState;
}) {
  if (readiness.cliEntry?.status.kind === "error") {
    return (
      <Badge variant="secondary" className="gap-1">
        <AlertCircleIcon className="size-3 text-destructive" />
        <span>Error</span>
      </Badge>
    );
  }

  if (connectionState === "failed") {
    return (
      <Badge variant="secondary" className="gap-1">
        <AlertCircleIcon className="size-3 text-destructive" />
        <span>Connection failed</span>
      </Badge>
    );
  }

  if (connectionState === "checking") {
    return (
      <Badge variant="outline" className="gap-1.5">
        <Spinner className="size-3" />
        <span>Testing…</span>
      </Badge>
    );
  }

  if (allReady && (!starter.hasConnectionCheck || connectionState === "connected")) {
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2Icon className="size-3 text-emerald-600 dark:text-emerald-400" />
        <span>Ready</span>
      </Badge>
    );
  }

  if (allReady && starter.hasConnectionCheck) {
    return <Badge variant="outline">Not tested</Badge>;
  }

  return <Badge variant="outline">Needs setup</Badge>;
}

export function StarterSetupCard({
  idPrefix,
  starter,
  readiness,
  starterConfig,
  fieldErrors,
  oauthPresets,
  oauthLogins,
  installRunner,
  sharedOAuthProviders,
  refreshNonce = 0,
  onConfigChange,
}: {
  idPrefix: string;
  starter: StarterSummary;
  readiness: StarterReadiness;
  starterConfig: StarterConfig;
  fieldErrors: Readonly<Record<string, string>>;
  oauthPresets: readonly OAuthPresetSummary[];
  oauthLogins: readonly OAuthStatusEntry[];
  installRunner: CliInstallRunner;
  sharedOAuthProviders?: ReadonlySet<OAuthProviderId> | undefined;
  refreshNonce?: number;
  onConfigChange: (starterId: string, fieldKey: string, value: string) => void;
}) {
  const configReady = isStarterConfigValid(starter, starterConfig);
  const allReady = readiness.isVmReady && configReady;
  const hasConfigFields = starter.configFields.length > 0;
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const [connectionState, setConnectionState] = useState<StarterConnectionState>("idle");
  const expanded = userExpanded ?? (!allReady || hasConfigFields);

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setUserExpanded(!expanded)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5 text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          {expanded ? (
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <StarterIcon starter={starter} />
          <span className="truncate text-sm font-semibold">{starter.name}</span>
          <StarterBadges starter={starter} />
        </div>

        <StarterSetupStatusBadge
          readiness={readiness}
          starter={starter}
          allReady={allReady}
          connectionState={connectionState}
        />
      </button>

      <div
        className={expanded ? "space-y-4 border-t border-border px-3.5 py-3" : "hidden"}
        hidden={!expanded}
      >
        {hasConfigFields && (
          <StarterConfigFields
            idPrefix={idPrefix}
            starter={starter}
            values={starterConfig[starter.id] ?? {}}
            fieldErrors={fieldErrors}
            canTestConnection={!readiness.needsBinaryInstall}
            refreshNonce={refreshNonce}
            onConnectionStateChange={setConnectionState}
            onChange={(fieldKey, value) => onConfigChange(starter.id, fieldKey, value)}
          />
        )}

        <StarterVmSetupPanels
          starter={starter}
          readiness={readiness}
          starterConfig={starterConfig}
          oauthPresets={oauthPresets}
          oauthLogins={oauthLogins}
          installRunner={installRunner}
          sharedOAuthProviders={sharedOAuthProviders}
        />
      </div>
    </div>
  );
}
