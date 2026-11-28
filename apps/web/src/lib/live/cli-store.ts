import { useEffect, useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { CliAuthFlowState, CliInstallJobState } from "@tetherbox/core/app";
import { ApiError, appClient, queryKeys, unwrapJson } from "../api.ts";
import { createListenerSet } from "./listeners.ts";

const cliInstallJobs = new Map<string, CliInstallJobState>();
const cliAuthFlows = new Map<string, CliAuthFlowState>();
const watchedAuthFlowIds = new Set<string>();
const UNWATCHED_SETTLED_AUTH_FLOW_TTL_MS = 30_000;
const EMPTY_CLI_INSTALL_JOBS: Readonly<Record<string, CliInstallJobState>> = {};
let cliInstallJobsSnapshot: Readonly<Record<string, CliInstallJobState>> = EMPTY_CLI_INSTALL_JOBS;
const { subscribe, emit } = createListenerSet();

function rebuildInstallSnapshot(): void {
  cliInstallJobsSnapshot =
    cliInstallJobs.size === 0 ? EMPTY_CLI_INSTALL_JOBS : Object.fromEntries(cliInstallJobs);
}

function isStale<T extends CliInstallJobState | CliAuthFlowState>(
  existing: T | undefined,
  incoming: T,
): boolean {
  if (existing?.id !== incoming.id || incoming.status !== "running") {
    return false;
  }

  return existing.status !== "running" || incoming.output.length < existing.output.length;
}

function isNewlySettled<T extends CliInstallJobState | CliAuthFlowState>(
  existing: T | undefined,
  incoming: T,
): boolean {
  return (
    incoming.status !== "running" &&
    (existing?.id !== incoming.id || existing.status !== incoming.status)
  );
}

export function upsertCliInstallJob(job: CliInstallJobState, queryClient: QueryClient): void {
  const existing = cliInstallJobs.get(job.starterId);

  if (isStale(existing, job)) {
    return;
  }

  cliInstallJobs.set(job.starterId, job);
  rebuildInstallSnapshot();
  emit();

  if (isNewlySettled(existing, job)) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.cliStatus });
  }
}

export function upsertCliAuthFlow(flow: CliAuthFlowState, queryClient: QueryClient): void {
  const existing = cliAuthFlows.get(flow.id);

  if (isStale(existing, flow)) {
    return;
  }

  if (flow.status === "completed" && isNewlySettled(existing, flow)) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.cliStatus });
  }

  cliAuthFlows.set(flow.id, flow);
  emit();

  if (flow.status !== "running" && !watchedAuthFlowIds.has(flow.id)) {
    setTimeout(() => {
      if (!watchedAuthFlowIds.has(flow.id) && cliAuthFlows.delete(flow.id)) {
        emit();
      }
    }, UNWATCHED_SETTLED_AUTH_FLOW_TTL_MS);
  }
}

export function watchCliAuthFlow(flow: CliAuthFlowState, queryClient: QueryClient): void {
  watchedAuthFlowIds.add(flow.id);
  upsertCliAuthFlow(flow, queryClient);
}

function releaseCliAuthFlow(flowId: string): void {
  watchedAuthFlowIds.delete(flowId);

  if (cliAuthFlows.delete(flowId)) {
    emit();
  }
}

export function useCliInstallJobs(): Readonly<Record<string, CliInstallJobState>> {
  return useSyncExternalStore(
    subscribe,
    () => cliInstallJobsSnapshot,
    () => EMPTY_CLI_INSTALL_JOBS,
  );
}

export function useCliAuthFlow(flowId: string | null): CliAuthFlowState | null {
  useEffect(() => {
    if (flowId === null) {
      return;
    }

    return () => {
      releaseCliAuthFlow(flowId);
    };
  }, [flowId]);

  return useSyncExternalStore(
    subscribe,
    () => (flowId === null ? null : (cliAuthFlows.get(flowId) ?? null)),
    () => null,
  );
}

export function clearSettledCliInstallJobs(): void {
  let changed = false;

  for (const [starterId, job] of cliInstallJobs) {
    if (job.status !== "running") {
      cliInstallJobs.delete(starterId);
      changed = true;
    }
  }

  if (changed) {
    rebuildInstallSnapshot();
    emit();
  }
}

export function clearCliState(): void {
  let changed = false;

  if (cliInstallJobs.size > 0) {
    cliInstallJobs.clear();
    rebuildInstallSnapshot();
    changed = true;
  }

  if (cliAuthFlows.size > 0) {
    cliAuthFlows.clear();
    changed = true;
  }

  if (changed) {
    emit();
  }
}

async function refetchUnlessGone<T>({
  request,
  onFound,
  onGone,
}: {
  request: () => Promise<T>;
  onFound: (result: T) => void;
  onGone: () => void;
}): Promise<void> {
  try {
    onFound(await request());
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      onGone();
    }
  }
}

export async function resyncActiveCliState(queryClient: QueryClient): Promise<void> {
  const runningInstalls = [...cliInstallJobs.values()].filter((job) => job.status === "running");
  const runningFlows = [...cliAuthFlows.values()].filter((flow) => flow.status === "running");

  await Promise.all([
    ...runningInstalls.map((job) =>
      refetchUnlessGone({
        request: async () =>
          unwrapJson(await appClient.clis.installs[":jobId"].$get({ param: { jobId: job.id } })),
        onFound: (result) => {
          upsertCliInstallJob(result.job, queryClient);
        },
        onGone: () => {
          upsertCliInstallJob(
            { ...job, status: "failed", error: "Connection lost before install finished" },
            queryClient,
          );
        },
      }),
    ),
    ...runningFlows.map((flow) =>
      refetchUnlessGone({
        request: async () =>
          unwrapJson(
            await appClient.clis.auth.flows[":flowId"].$get({ param: { flowId: flow.id } }),
          ),
        onFound: (result) => {
          upsertCliAuthFlow(result.flow, queryClient);
        },
        onGone: () => {
          upsertCliAuthFlow(
            {
              ...flow,
              status: "failed",
              prompt: null,
              error: "Connection lost before sign-in finished",
            },
            queryClient,
          );
        },
      }),
    ),
  ]);
}
