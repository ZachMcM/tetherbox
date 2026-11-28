import type { StarterCliStatusEntry } from "@tetherbox/core/app";
import { CheckCircle2Icon, ChevronDownIcon, ChevronRightIcon, DownloadIcon } from "lucide-react";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import { FieldError } from "@tetherbox/ui/components/field";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { AuthorizationPendingAlert } from "../auth-setup/authorization-pending-alert.tsx";
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
    return <Badge variant="destructive">Error</Badge>;
  }

  if (!isInstalled) {
    return isInstalling ? (
      <Badge variant="outline" className="gap-1.5">
        <Spinner className="size-3" />
        <span>Installing…</span>
      </Badge>
    ) : (
      <Badge variant="outline">Not installed</Badge>
    );
  }

  if (!entry.hasAuth || authState === "none") {
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2Icon className="size-3 text-emerald-600 dark:text-emerald-400" />
        <span>Installed</span>
      </Badge>
    );
  }

  if (authState === "authenticated") {
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2Icon className="size-3 text-emerald-600 dark:text-emerald-400" />
        <span>Signed in</span>
      </Badge>
    );
  }

  if (authState === "unknown") {
    return <Badge variant="secondary">Installed</Badge>;
  }

  return <Badge variant="outline">Not signed in</Badge>;
}

export function CliAuthFlowPanel({
  entry,
  installRunner,
}: {
  entry: StarterCliStatusEntry;
  installRunner: CliInstallRunner;
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

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold">
              {entry.hasAuth ? `${entry.name} CLI login` : `${entry.name} CLI`}
            </span>
            <code className="font-mono text-xs text-muted-foreground">{entry.binary}</code>
            <Badge variant="secondary" className="text-[10px] font-normal">
              VM-wide
            </Badge>
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
          <CliStatusBadge
            entry={entry}
            isInstalled={isInstalled}
            isInstalling={isInstalling}
            authState={authState}
          />

          {entry.status.kind === "error" ? null : !isInstalled ? (
            entry.hasInstall &&
            !isInstalling && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => void installRunner.installOne(entry.starterId)}
              >
                <DownloadIcon className="size-3" />
                <span>Install</span>
              </Button>
            )
          ) : entry.hasAuth ? (
            activeFlow !== null ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={auth.isCancelling}
                onClick={auth.cancel}
              >
                Cancel
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={auth.isStarting}
                onClick={auth.start}
              >
                {auth.isStarting
                  ? "Starting…"
                  : authState === "authenticated"
                    ? "Reconnect"
                    : "Sign in"}
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

      {activeFlow !== null && (
        <div className="space-y-2.5 pt-1">
          {auth.deviceCode !== undefined ? (
            <DeviceCodePrompt
              key={activeFlow.id}
              userCode={auth.deviceCode.userCode}
              verificationUri={auth.deviceCode.verificationUri}
              message="Open the verification page and enter this one-time code:"
            />
          ) : auth.authUrl !== undefined ? (
            <AuthorizationPendingAlert url={auth.authUrl} message="Waiting for browser sign-in…" />
          ) : (
            <AuthorizationPendingAlert message={`Waiting for ${entry.binary} sign-in prompt…`} />
          )}

          {(activeFlow.prompt !== null || auth.showOutput) && (
            <CliResponseForm
              inputId={`cli-auth-input-${entry.starterId}`}
              prompt={activeFlow.prompt}
              value={auth.responseInput}
              pending={auth.isResponding}
              onChange={auth.setResponseInput}
              onSubmit={auth.respond}
            />
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
            <span>{auth.showOutput ? "Hide CLI output" : "Show CLI output / reply"}</span>
          </button>

          {auth.showOutput && <CliOutputLog output={activeFlow.output} variant="live" />}

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
