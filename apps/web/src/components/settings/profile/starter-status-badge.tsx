import type { StarterConfig, StarterSummary } from "@tetherbox/core/app";
import { CheckCircle2Icon } from "lucide-react";
import { Badge } from "@tetherbox/ui/components/badge";
import { isStarterConfigValid, type StarterReadiness } from "../../profile-form-fields.tsx";

export function starterStatusBadge(
  starter: StarterSummary,
  enabled: boolean,
  readiness: StarterReadiness | undefined,
  starterConfig: StarterConfig,
) {
  if (readiness === undefined) {
    return null;
  }

  if (!enabled) {
    return readiness.hasVmRequirements && readiness.isVmReady ? (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
        <CheckCircle2Icon className="size-3" />
        <span>Ready on VM</span>
      </span>
    ) : null;
  }

  if (!readiness.isStatusLoaded) {
    return <Badge variant="outline">Checking…</Badge>;
  }

  if (readiness.cliEntry?.status.kind === "error") {
    return <Badge variant="destructive">Error</Badge>;
  }

  if (readiness.needsBinaryInstall) {
    return <Badge variant="outline">Needs install</Badge>;
  }

  if (readiness.needsCliAuth) {
    return <Badge variant="outline">Needs sign-in</Badge>;
  }

  if (readiness.missingSecrets.length > 0) {
    return <Badge variant="outline">Needs secret</Badge>;
  }

  if (readiness.missingOAuthPreset !== undefined) {
    return <Badge variant="outline">Needs OAuth</Badge>;
  }

  if (!isStarterConfigValid(starter, starterConfig)) {
    return <Badge variant="outline">Needs config</Badge>;
  }

  return (
    <Badge variant="secondary" className="gap-1">
      <CheckCircle2Icon className="size-3 text-emerald-600 dark:text-emerald-400" />
      <span>Ready</span>
    </Badge>
  );
}
