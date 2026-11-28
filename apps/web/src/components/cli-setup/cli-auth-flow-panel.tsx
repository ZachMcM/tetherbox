import type { StarterCliStatusEntry } from "@tetherbox/core/app";
import { ChevronDownIcon, ChevronRightIcon, DownloadIcon, LogInIcon } from "lucide-react";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import { FieldError } from "@tetherbox/ui/components/field";
import { StatusBadge } from "@tetherbox/ui/components/status-badge";
import { AuthorizationPendingAlert } from "../auth-setup/authorization-pending-alert.tsx";
import { CodePastePrompt } from "../auth-setup/code-paste-prompt.tsx";
import { DeviceCodePrompt } from "../auth-setup/device-code-prompt.tsx";
import { CliOutputLog } from "./cli-output-log.tsx";
import { CliResponseForm } from "./cli-response-form.tsx";
import { useCliAuthFlow } from "./use-cli-auth-flow.ts";
import { isCliInstalled, type CliInstallRunner } from "./use-cli-install-runner.ts";

type AuthState = "none" | "unknown" | "authenticated" | "unauthenticated";

function CliStatusBadge({
  entry,
  isInstalled,
  isInstalling,
  authState,
}: {
  entry: StarterCliStatusEntry;
  isInstalled: boolean;
  isInstalling: boolean;
  authState: AuthState;
}) {
  if (entry.status.kind === "error") {
    return <StatusBadge status="error">Error</StatusBadge>;
  }

  if (isInstalling) {
    return <StatusBadge status="pending">Installing…</StatusBadge>;
  }

  if (!isInstalled) {
    return entry.hasInstall ? null : <StatusBadge status="attention">Not installed</StatusBadge>;
  }

  if (authState === "authenticated") {
    return <StatusBadge status="success">Signed in</StatusBadge>;
  }

  if (authState === "unauthenticated") {
    return null;
  }

  return <StatusBadge status="success">Installed</StatusBadge>;
}

export function CliAuthFlowPanel({
  entry,
  installRunner,
  showStatusBadge = true,
}: {
  entry: StarterCliStatusEntry;
  installRunner: CliInstallRunner;
  showStatusBadge?: boolean;
}) {
  const auth = useCliAuthFlow(entry);
  const { activeFlow, flow } = auth;

  const installJob = installRunner.jobs[entry.starterId];
  const isInstalling =
    installRunner.starting[entry.starterId] === true || installJob?.status === "running";
  const isInstalled = !isInstalling && isCliInstalled(entry, installJob);
  const authState: AuthState =
    entry.status.kind === "installed"
      ? entry.status.auth
      : entry.hasAuth
        ? "unauthenticated"
        : "none";
  const cliLabel = entry.name.endsWith("CLI") ? entry.name : `${entry.name} CLI`;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold">
              {entry.hasAuth ? `${cliLabel} login` : cliLabel}
            </span>
            <code className="font-mono text-xs text-muted-foreground">{entry.binary}</code>
            <Badge variant="attribute">VM-wide</Badge>
          </div>
          {entry.status.kind === "error" && (
            <div className="mt-0.5 text-xs text-destructive">{entry.status.message}</div>
          )}
          {!isInstalled &&
            entry.status.kind !== "error" &&
            entry.installDescription !== undefined && (
              <div className="mt-0.5 text-xs text-muted-foreground">{entry.installDescription}</div>
            )}
        </div>

        <div className="flex items-center gap-2">
          {showStatusBadge && (
            <CliStatusBadge
              entry={entry}
              isInstalled={isInstalled}
              isInstalling={isInstalling}
              authState={authState}
            />
          )}

          {entry.status.kind === "error" ? null : !isInstalled ? (
            entry.hasInstall &&
            !isInstalling && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => void installRunner.installOne(entry.starterId)}
              >
                <DownloadIcon data-icon="inline-start" />
                <span>Install</span>
              </Button>
            )
          ) : entry.hasAuth ? (
            activeFlow !== null ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={auth.isCancelling}
                onClick={auth.cancel}
              >
                Cancel
              </Button>
            ) : (
              <Button
                type="button"
                variant={authState === "authenticated" ? "ghost" : "outline"}
                size="xs"
                disabled={auth.isStarting}
                onClick={auth.start}
              >
                {authState !== "authenticated" && <LogInIcon data-icon="inline-start" />}
                <span>
                  {auth.isStarting
                    ? "Starting…"
                    : authState === "authenticated"
                      ? "Reconnect"
                      : "Sign in"}
                </span>
              </Button>
            )
          ) : null}
        </div>
      </div>

      {installJob?.status === "failed" && !isInstalled && (
        <div className="space-y-1.5">
          <FieldError>{installJob.error}</FieldError>
          <CliOutputLog output={installJob.output} variant="error" />
        </div>
      )}

      {auth.isStarting && activeFlow === null && (
        <div className="pt-1">
          <AuthorizationPendingAlert message={`Starting ${entry.binary} sign-in…`} />
        </div>
      )}

      {activeFlow !== null && (
        <div className="space-y-2.5 pt-1">
          {auth.deviceCode !== undefined ? (
            <DeviceCodePrompt
              key={activeFlow.id}
              userCode={auth.deviceCode.userCode}
              verificationUri={auth.deviceCode.verificationUri}
              message="Open the verification page and enter this one-time code:"
              variant="compact"
            />
          ) : activeFlow.prompt !== null ? (
            <CodePastePrompt
              inputId={`cli-auth-input-${entry.starterId}`}
              title={
                auth.authUrl !== undefined
                  ? "Paste your sign-in code"
                  : activeFlow.prompt.replace(/\s*[:?>]\s*$/, "")
              }
              placeholder={auth.authUrl !== undefined ? "Paste code from browser" : "Enter reply"}
              value={auth.responseInput}
              pending={auth.isResponding}
              authUrl={auth.authUrl}
              requireValue={false}
              variant="compact"
              onChange={auth.setResponseInput}
              onSubmit={auth.respond}
            />
          ) : auth.authUrl !== undefined ? (
            <AuthorizationPendingAlert url={auth.authUrl} message="Waiting for browser sign-in…" />
          ) : (
            <AuthorizationPendingAlert message={`Waiting for ${entry.binary} sign-in prompt…`} />
          )}

          <button
            type="button"
            onClick={auth.toggleOutput}
            className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {auth.showOutput ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            )}
            <span>{auth.showOutput ? "Hide CLI output" : "Show CLI output"}</span>
          </button>

          {auth.showOutput && (
            <div className="space-y-2.5">
              <CliOutputLog output={activeFlow.output} variant="live" />
              {auth.deviceCode === undefined && activeFlow.prompt === null && (
                <CliResponseForm
                  inputId={`cli-auth-input-${entry.starterId}`}
                  prompt={activeFlow.prompt}
                  value={auth.responseInput}
                  pending={auth.isResponding}
                  onChange={auth.setResponseInput}
                  onSubmit={auth.respond}
                />
              )}
            </div>
          )}

          {auth.respondError !== null && <FieldError>{auth.respondError.message}</FieldError>}
        </div>
      )}

      {flow?.status === "failed" && (
        <div className="space-y-1.5">
          <FieldError>{flow.error}</FieldError>
          <CliOutputLog output={flow.output} variant="error" />
        </div>
      )}
    </div>
  );
}
