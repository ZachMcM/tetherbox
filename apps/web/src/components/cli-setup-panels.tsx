import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CliAuthFlowState,
  CliInstallJobState,
  StarterCliStatusEntry,
} from "@tetherbox/core/app";
import {
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  TerminalIcon,
} from "lucide-react";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import { Field, FieldError, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { toast } from "@tetherbox/ui/components/toast";
import { appClient, queryKeys, unwrapJson } from "../lib/api.ts";
import { openAuthWindow } from "./auth-setup-panels.tsx";

export interface CliInstallRunner {
  readonly jobs: Readonly<Record<string, CliInstallJobState>>;
  readonly starting: Readonly<Record<string, boolean>>;
  readonly isAnyRunning: boolean;
  readonly installOne: (starterId: string) => Promise<void>;
  readonly installAll: (starterIds: readonly string[]) => Promise<void>;
}

export function useCliInstallRunner(): CliInstallRunner {
  const queryClient = useQueryClient();
  const [jobs, setJobs] = useState<Record<string, CliInstallJobState>>({});
  const [starting, setStarting] = useState<Record<string, boolean>>({});
  const jobsRef = useRef(jobs);
  const handledRef = useRef<Set<string>>(new Set());

  jobsRef.current = jobs;

  const runningJobKey = Object.values(jobs)
    .filter((job) => job.status === "running")
    .map((job) => job.id)
    .toSorted()
    .join(",");

  useEffect(() => {
    if (runningJobKey === "") {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      const activeJobs = Object.values(jobsRef.current).filter((job) => job.status === "running");

      if (activeJobs.length === 0) {
        return;
      }

      const updates = await Promise.all(
        activeJobs.map(async (job) => {
          try {
            const result = await unwrapJson(
              await appClient.clis.installs[":jobId"].$get({ param: { jobId: job.id } }),
            );

            return result.job;
          } catch {
            return job;
          }
        }),
      );

      if (cancelled) {
        return;
      }

      setJobs((prev) => {
        const next = { ...prev };

        for (const job of updates) {
          next[job.starterId] = job;
        }

        return next;
      });
    };

    const timer = setInterval(() => {
      void poll();
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runningJobKey]);

  useEffect(() => {
    let shouldInvalidate = false;

    for (const job of Object.values(jobs)) {
      if (job.status === "running" || handledRef.current.has(job.id)) {
        continue;
      }

      handledRef.current.add(job.id);
      shouldInvalidate = true;

      if (job.status === "completed") {
        toast.add({
          type: "success",
          title: `Installed ${job.binary}`,
        });
      } else {
        toast.add({
          type: "error",
          title: `Could not install ${job.binary}`,
          description: job.error,
        });
      }
    }

    if (shouldInvalidate) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.cliStatus });
    }
  }, [jobs, queryClient]);

  const installOne = useCallback(async (starterId: string) => {
    setStarting((prev) => ({ ...prev, [starterId]: true }));

    try {
      const result = await unwrapJson(
        await appClient.clis[":starterId"].install.$post({ param: { starterId } }),
      );

      setJobs((prev) => ({ ...prev, [starterId]: result.job }));
    } catch (error) {
      toast.add({
        type: "error",
        title: `Could not start ${starterId} install`,
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setStarting((prev) => ({ ...prev, [starterId]: false }));
    }
  }, []);

  const installAll = useCallback(
    async (starterIds: readonly string[]) => {
      await Promise.all(starterIds.map((id) => installOne(id)));
    },
    [installOne],
  );

  const isAnyRunning =
    runningJobKey !== "" || Object.values(starting).some((isStarting) => isStarting);

  return { jobs, starting, isAnyRunning, installOne, installAll };
}

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

              {showLog && job !== undefined && job.output.trim() !== "" && (
                <pre className="max-h-36 overflow-auto rounded-md border border-border bg-muted/50 p-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
                  {job.output.trim()}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CliAuthFlowPanel({
  entry,
  installRunner,
}: {
  entry: StarterCliStatusEntry;
  installRunner: CliInstallRunner;
}) {
  const queryClient = useQueryClient();
  const [flow, setFlow] = useState<CliAuthFlowState | null>(null);
  const [responseInput, setResponseInput] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const openedUrlRef = useRef<string | null>(null);
  const handledFlowIdRef = useRef<string | null>(null);
  const activeFlowIdRef = useRef<string | undefined>(undefined);
  const mountedRef = useRef(true);

  const installJob = installRunner.jobs[entry.starterId];
  const isInstalling =
    installRunner.starting[entry.starterId] === true || installJob?.status === "running";
  const isInstalled = entry.status.kind === "installed" || installJob?.status === "completed";
  const authState =
    entry.status.kind === "installed"
      ? entry.status.auth
      : entry.hasAuth
        ? "unauthenticated"
        : "none";

  const startMutation = useMutation({
    mutationFn: async () =>
      unwrapJson(
        await appClient.clis[":starterId"].auth.start.$post({
          param: { starterId: entry.starterId },
        }),
      ),
    onSuccess: (data) => {
      if (!mountedRef.current) {
        void appClient.clis.auth.flows[":flowId"].cancel.$post({ param: { flowId: data.flow.id } });

        return;
      }

      openedUrlRef.current = null;
      setResponseInput("");
      setCopiedCode(false);
      setFlow(data.flow);
    },
    onError: (error) => {
      toast.add({
        type: "error",
        title: `Could not start ${entry.name} login`,
        description: error.message,
      });
    },
  });

  const respondMutation = useMutation({
    mutationFn: async ({ flowId, value }: { flowId: string; value: string }) =>
      unwrapJson(
        await appClient.clis.auth.flows[":flowId"].respond.$post({
          param: { flowId },
          json: { value },
        }),
      ),
    onSuccess: (data) => {
      setResponseInput("");
      setFlow(data.flow);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (flowId: string) =>
      unwrapJson(await appClient.clis.auth.flows[":flowId"].cancel.$post({ param: { flowId } })),
    onSuccess: () => {
      setFlow(null);
      setResponseInput("");
    },
  });

  const activeFlow = flow?.status === "running" ? flow : null;
  const activeFlowId = activeFlow?.id;
  const deviceCodeEvent = activeFlow?.events.findLast((event) => event.kind === "device_code");
  const authUrl =
    deviceCodeEvent?.verificationUri ??
    activeFlow?.events.findLast((event) => event.kind === "auth_url")?.url;

  useEffect(() => {
    activeFlowIdRef.current = activeFlowId;
  }, [activeFlowId]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      const pendingId = activeFlowIdRef.current;

      if (pendingId !== undefined) {
        void appClient.clis.auth.flows[":flowId"].cancel.$post({ param: { flowId: pendingId } });
      }
    };
  }, []);

  useEffect(() => {
    if (activeFlowId === undefined) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const result = await unwrapJson(
          await appClient.clis.auth.flows[":flowId"].$get({ param: { flowId: activeFlowId } }),
        );

        if (!cancelled) {
          setFlow(result.flow);
        }
      } catch {
        // Keep latest state on transient poll failure.
      }
    };

    const timer = setInterval(() => {
      void poll();
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeFlowId]);

  useEffect(() => {
    if (authUrl !== undefined && openedUrlRef.current !== authUrl) {
      openedUrlRef.current = authUrl;
      openAuthWindow(authUrl);
    }
  }, [authUrl]);

  useEffect(() => {
    if (flow === null || flow.status === "running" || handledFlowIdRef.current === flow.id) {
      return;
    }

    handledFlowIdRef.current = flow.id;

    if (flow.status === "completed") {
      void queryClient.invalidateQueries({ queryKey: queryKeys.cliStatus });
      toast.add({
        type: "success",
        title: `${entry.name} signed in`,
      });
      setFlow(null);
    } else if (flow.status === "failed") {
      toast.add({
        type: "error",
        title: `${entry.name} sign-in failed`,
        description: flow.error,
      });
      setShowOutput(true);
    }
  }, [flow, entry.name, queryClient]);

  const handleRespond = (event: FormEvent) => {
    event.preventDefault();

    if (activeFlow !== null) {
      respondMutation.mutate({ flowId: activeFlow.id, value: responseInput });
    }
  };

  let statusBadge = <Badge variant="outline">Not signed in</Badge>;

  if (entry.status.kind === "error") {
    statusBadge = <Badge variant="destructive">Error</Badge>;
  } else if (!isInstalled) {
    statusBadge = isInstalling ? (
      <Badge variant="outline" className="gap-1.5">
        <Spinner className="size-3" />
        <span>Installing…</span>
      </Badge>
    ) : (
      <Badge variant="outline">Not installed</Badge>
    );
  } else if (!entry.hasAuth || authState === "none") {
    statusBadge = (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2Icon className="size-3 text-emerald-600 dark:text-emerald-400" />
        <span>Installed</span>
      </Badge>
    );
  } else if (authState === "authenticated") {
    statusBadge = (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2Icon className="size-3 text-emerald-600 dark:text-emerald-400" />
        <span>Signed in</span>
      </Badge>
    );
  } else if (authState === "unknown") {
    statusBadge = <Badge variant="secondary">Installed</Badge>;
  }

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
          {statusBadge}

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
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate(activeFlow.id)}
              >
                Cancel
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={startMutation.isPending}
                onClick={() => startMutation.mutate()}
              >
                {startMutation.isPending
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
          {installJob.output.trim() !== "" && (
            <pre className="max-h-32 overflow-auto rounded-md border border-border bg-muted/50 p-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
              {installJob.output.trim()}
            </pre>
          )}
        </div>
      )}

      {activeFlow !== null && (
        <div className="space-y-2.5 rounded-lg border border-border bg-muted/30 p-3">
          {deviceCodeEvent !== undefined ? (
            <div className="space-y-2 text-xs">
              <p className="text-muted-foreground">
                Open the verification page and enter this one-time code:
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-background px-2 py-1 font-mono text-sm font-semibold tracking-wider">
                  {deviceCodeEvent.userCode}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    void navigator.clipboard.writeText(deviceCodeEvent.userCode).then(() => {
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 1500);
                    });
                  }}
                >
                  {copiedCode ? (
                    <CheckIcon className="size-3.5" />
                  ) : (
                    <CopyIcon className="size-3.5" />
                  )}
                  <span>{copiedCode ? "Copied" : "Copy"}</span>
                </Button>
                <a
                  href={deviceCodeEvent.verificationUri}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4"
                >
                  <span>Open verification page</span>
                  <ExternalLinkIcon className="size-3.5" />
                </a>
              </div>
            </div>
          ) : authUrl !== undefined ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <Spinner className="size-3.5" />
              <span>Complete sign-in in the browser tab.</span>
              <a
                href={authUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4"
              >
                <span>Open sign-in page</span>
                <ExternalLinkIcon className="size-3.5" />
              </a>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3.5" />
              <span>Waiting for {entry.binary} sign-in prompt…</span>
            </div>
          )}

          {(activeFlow.prompt !== null || showOutput) && (
            <form onSubmit={handleRespond} className="space-y-1.5">
              <Field>
                <FieldLabel
                  htmlFor={`cli-auth-input-${entry.starterId}`}
                  className="text-xs font-normal text-muted-foreground"
                >
                  {activeFlow.prompt ?? "Send response to CLI (code, token, or Enter)"}
                </FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id={`cli-auth-input-${entry.starterId}`}
                    placeholder="Paste code or response"
                    value={responseInput}
                    onChange={(event) => setResponseInput(event.target.value)}
                  />
                  <Button type="submit" size="sm" disabled={respondMutation.isPending}>
                    Send
                  </Button>
                </div>
              </Field>
            </form>
          )}

          <button
            type="button"
            onClick={() => setShowOutput((prev) => !prev)}
            className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {showOutput ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            )}
            <span>{showOutput ? "Hide CLI output" : "Show CLI output / reply"}</span>
          </button>

          {showOutput && activeFlow.output.trim() !== "" && (
            <pre className="max-h-36 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
              {activeFlow.output.trim()}
            </pre>
          )}

          {respondMutation.error !== null && (
            <FieldError>{respondMutation.error.message}</FieldError>
          )}
        </div>
      )}

      {flow?.status === "failed" && (
        <div className="space-y-1.5">
          <FieldError>{flow.error}</FieldError>
          {flow.output.trim() !== "" && (
            <pre className="max-h-32 overflow-auto rounded-md border border-border bg-muted/50 p-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
              {flow.output.trim()}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
