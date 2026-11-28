import { useState } from "react";
import type { StarterCliStatusEntry } from "@tetherbox/core/app";
import { DownloadIcon, RotateCcwIcon, TerminalIcon } from "lucide-react";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import { FieldError } from "@tetherbox/ui/components/field";
import { StatusBadge } from "@tetherbox/ui/components/status-badge";
import { CliOutputLog } from "./cli-output-log.tsx";
import { isCliInstalled, type CliInstallRunner } from "./use-cli-install-runner.ts";

export function CliInstallCard({
  entries,
  runner,
}: {
  entries: readonly StarterCliStatusEntry[];
  runner: CliInstallRunner;
}) {
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({});

  if (entries.length === 0) {
    return null;
  }

  const installableMissing = entries.filter((entry) => {
    if (!entry.hasInstall) {
      return false;
    }

    const job = runner.jobs[entry.starterId];

    return (
      entry.status.kind !== "error" && job?.status !== "running" && !isCliInstalled(entry, job)
    );
  });

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Install CLIs on VM</span>
            <Badge variant="attribute">VM-wide · once</Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Installs binaries into user space (<code>~/.local/bin</code>) for the agent user. Runs
            in the background while you configure items below.
          </p>
        </div>
        {installableMissing.length > 0 && (
          <Button
            type="button"
            size="sm"
            disabled={runner.isAnyRunning}
            onClick={() =>
              void runner.installAll(installableMissing.map((entry) => entry.starterId))
            }
          >
            <DownloadIcon data-icon="inline-start" />
            <span>
              {installableMissing.length === 1
                ? `Install ${installableMissing[0]?.binary}`
                : `Install all (${installableMissing.length})`}
            </span>
          </Button>
        )}
      </div>

      <div className="divide-y divide-border border-t border-border">
        {entries.map((entry) => {
          const job = runner.jobs[entry.starterId];
          const isStarting = runner.starting[entry.starterId] === true;
          const isRunning = isStarting || job?.status === "running";
          const isInstalled = !isRunning && isCliInstalled(entry, job);
          const hasFailed = job?.status === "failed";
          const showLog = expandedLogs[entry.starterId] === true || hasFailed;

          return (
            <div key={entry.starterId} className="space-y-2 px-3.5 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-foreground">{entry.name}</span>
                    <code className="font-mono text-muted-foreground">{entry.binary}</code>
                  </div>
                  {entry.installDescription !== undefined && (
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {entry.installDescription}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {job !== undefined && job.output.trim() !== "" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        setExpandedLogs((prev) => ({
                          ...prev,
                          [entry.starterId]: !prev[entry.starterId],
                        }))
                      }
                    >
                      <TerminalIcon className="size-3" />
                      <span>{showLog ? "Hide log" : "Log"}</span>
                    </Button>
                  )}

                  {isInstalled ? (
                    <StatusBadge status="success">Installed</StatusBadge>
                  ) : isRunning ? (
                    <StatusBadge status="pending">Installing…</StatusBadge>
                  ) : entry.hasInstall ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => void runner.installOne(entry.starterId)}
                    >
                      {hasFailed ? (
                        <RotateCcwIcon data-icon="inline-start" />
                      ) : (
                        <DownloadIcon data-icon="inline-start" />
                      )}
                      <span>{hasFailed ? "Retry" : "Install"}</span>
                    </Button>
                  ) : (
                    <StatusBadge status="attention">Manual install</StatusBadge>
                  )}
                </div>
              </div>

              {hasFailed && <FieldError>{job.error}</FieldError>}

              {showLog && job !== undefined && <CliOutputLog output={job.output} variant="log" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
