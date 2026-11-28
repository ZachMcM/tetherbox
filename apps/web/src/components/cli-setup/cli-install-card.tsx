import { useState } from "react";
import type { StarterCliStatusEntry } from "@tetherbox/core/app";
import { CheckCircle2Icon, DownloadIcon, TerminalIcon } from "lucide-react";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import { FieldError } from "@tetherbox/ui/components/field";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { CliOutputLog } from "./cli-output-log.tsx";
import type { CliInstallRunner } from "./use-cli-install-runner.ts";

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
      entry.status.kind === "missing" && job?.status !== "running" && job?.status !== "completed"
    );
  });

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Install CLIs on VM</span>
            <Badge variant="secondary" className="text-[10px] font-normal">
              VM-wide · once
            </Badge>
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
            <DownloadIcon className="size-3.5" />
            <span>
              {installableMissing.length === 1
                ? `Install ${installableMissing[0]?.binary}`
                : `Install all (${installableMissing.length})`}
            </span>
          </Button>
        )}
      </div>

      <div className="divide-y divide-border rounded-lg border border-border">
        {entries.map((entry) => {
          const job = runner.jobs[entry.starterId];
          const isStarting = runner.starting[entry.starterId] === true;
          const isRunning = isStarting || job?.status === "running";
          const isInstalled = entry.status.kind === "installed" || job?.status === "completed";
          const hasFailed = !isInstalled && job?.status === "failed";
          const showLog = expandedLogs[entry.starterId] === true || hasFailed;

          return (
            <div key={entry.starterId} className="space-y-2 px-3 py-2.5">
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
                    <Badge variant="secondary" className="gap-1">
                      <CheckCircle2Icon className="size-3" />
                      <span>Installed</span>
                    </Badge>
                  ) : isRunning ? (
                    <Badge variant="outline" className="gap-1.5">
                      <Spinner className="size-3" />
                      <span>Installing…</span>
                    </Badge>
                  ) : entry.hasInstall ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => void runner.installOne(entry.starterId)}
                    >
                      {hasFailed ? "Retry" : "Install"}
                    </Button>
                  ) : (
                    <Badge variant="outline">Manual install</Badge>
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
