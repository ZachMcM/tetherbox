import type { StarterConfig, StarterSummary } from "@tetherbox/core/app";
import { StatusBadge } from "@tetherbox/ui/components/status-badge";
import { isStarterConfigValid, type StarterReadiness } from "../../../lib/starter-readiness.ts";

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
      <StatusBadge status="success">Ready on VM</StatusBadge>
    ) : null;
  }

  if (!readiness.isStatusLoaded) {
    return <StatusBadge status="pending">Checking…</StatusBadge>;
  }

  if (readiness.cliEntry?.status.kind === "error") {
    return <StatusBadge status="error">Error</StatusBadge>;
  }

  if (readiness.needsBinaryInstall) {
    return <StatusBadge status="attention">Needs install</StatusBadge>;
  }

  if (readiness.needsCliAuth) {
    return <StatusBadge status="attention">Needs sign-in</StatusBadge>;
  }

  if (readiness.missingSecrets.length > 0) {
    return <StatusBadge status="attention">Needs secret</StatusBadge>;
  }

  if (readiness.missingOAuthPreset !== undefined) {
    return <StatusBadge status="attention">Needs OAuth</StatusBadge>;
  }

  if (!isStarterConfigValid(starter, starterConfig)) {
    return <StatusBadge status="attention">Needs config</StatusBadge>;
  }

  return <StatusBadge status="success">Ready</StatusBadge>;
}
