import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  daemonEventSchema,
  type CliAuthFlowState,
  type CliInstallJobState,
  type DaemonEvent,
  type RunId,
  type SessionRecord,
  type TranscriptEntry,
  type TurnStreamEvent,
} from "@tetherbox/core/app";
import { ApiError, appClient, getAuthStatus, queryKeys, unwrapJson } from "./api.ts";

export interface LiveToolCall {
  toolCallId: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  status: "running" | "done" | "error";
  durationMs?: number;
}

export type LiveAssistantBlock =
  | { kind: "thinking"; text: string; streaming?: boolean }
  | { kind: "text"; text: string }
  | (LiveToolCall & { kind: "tool" });

export interface LiveAssistantStep {
  blocks: LiveAssistantBlock[];
  sealed: boolean;
}

export interface LiveTurnState {
  runId: RunId;
  triggerText?: string;
  baselineEntryCount?: number;
  steps: LiveAssistantStep[];
}

function finishStreamingThinking(blocks: readonly LiveAssistantBlock[]): LiveAssistantBlock[] {
  let changed = false;
  const next = blocks.map((block) => {
    if (block.kind === "thinking" && block.streaming) {
      changed = true;

      return { kind: "thinking" as const, text: block.text };
    }

    return block;
  });

  return changed ? next : [...blocks];
}

function ensureOpenStep(steps: readonly LiveAssistantStep[]): LiveAssistantStep[] {
  const last = steps.at(-1);

  if (last !== undefined && !last.sealed) {
    return [...steps];
  }

  return [...steps, { blocks: [], sealed: false }];
}

function updateCurrentStep(
  steps: readonly LiveAssistantStep[],
  updater: (blocks: LiveAssistantBlock[]) => LiveAssistantBlock[],
): LiveAssistantStep[] {
  const next = ensureOpenStep(steps);
  const lastIndex = next.length - 1;
  const current = next[lastIndex];

  if (current === undefined) {
    return next;
  }

  next[lastIndex] = { ...current, blocks: updater([...current.blocks]) };

  return next;
}

function getMessageRole(message: unknown): string | undefined {
  if (typeof message === "object" && message !== null && "role" in message) {
    return typeof message.role === "string" ? message.role : undefined;
  }

  return undefined;
}

function updateToolStep(
  steps: readonly LiveAssistantStep[],
  updater: (blocks: LiveAssistantBlock[]) => LiveAssistantBlock[],
): LiveAssistantStep[] {
  const next = steps.length === 0 ? [{ blocks: [], sealed: true }] : [...steps];
  const lastIndex = next.length - 1;
  const current = next[lastIndex];

  if (current === undefined) {
    return next;
  }

  next[lastIndex] = { ...current, blocks: updater([...current.blocks]) };

  return next;
}

function applyTurnEventToState(
  previous: LiveTurnState | undefined,
  runId: RunId,
  event: TurnStreamEvent,
): LiveTurnState {
  const current: LiveTurnState =
    previous !== undefined && previous.runId === runId ? previous : { runId, steps: [] };

  switch (event.kind) {
    case "thinking_delta":
      return {
        ...current,
        steps: updateCurrentStep(current.steps, (blocks) => {
          const last = blocks.at(-1);

          if (last?.kind === "thinking" && last.streaming) {
            blocks[blocks.length - 1] = {
              kind: "thinking",
              text: last.text + event.delta,
              streaming: true,
            };

            return blocks;
          }

          return [...blocks, { kind: "thinking", text: event.delta, streaming: true }];
        }),
      };
    case "text_delta":
      return {
        ...current,
        steps: updateCurrentStep(current.steps, (rawBlocks) => {
          const blocks = finishStreamingThinking(rawBlocks);
          const last = blocks.at(-1);

          if (last?.kind === "text") {
            blocks[blocks.length - 1] = { kind: "text", text: last.text + event.delta };

            return blocks;
          }

          return [...blocks, { kind: "text", text: event.delta }];
        }),
      };
    case "tool_start":
      return {
        ...current,
        steps: updateToolStep(current.steps, (rawBlocks) => {
          const blocks = finishStreamingThinking(rawBlocks);
          const existingIndex = blocks.findIndex(
            (block) => block.kind === "tool" && block.toolCallId === event.toolCallId,
          );
          const toolBlock: LiveAssistantBlock = {
            kind: "tool",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
            status: "running",
          };

          if (existingIndex !== -1) {
            blocks[existingIndex] = toolBlock;

            return blocks;
          }

          return [...blocks, toolBlock];
        }),
      };
    case "tool_update":
      return {
        ...current,
        steps: current.steps.map((step) => ({
          ...step,
          blocks: step.blocks.map((block) =>
            block.kind === "tool" && block.toolCallId === event.toolCallId
              ? { ...block, result: event.partialResult }
              : block,
          ),
        })),
      };
    case "tool_end":
      return {
        ...current,
        steps: current.steps.map((step) => ({
          ...step,
          blocks: step.blocks.map((block) =>
            block.kind === "tool" && block.toolCallId === event.toolCallId
              ? {
                  ...block,
                  result: event.result,
                  status: event.isError ? "error" : "done",
                  ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
                }
              : block,
          ),
        })),
      };
    case "message_end": {
      if (getMessageRole(event.message) !== "assistant") {
        return current;
      }

      const lastIndex = current.steps.length - 1;
      const last = current.steps[lastIndex];

      if (last === undefined || last.sealed) {
        return {
          ...current,
          steps: [...current.steps, { blocks: [], sealed: true }],
        };
      }

      const nextSteps = [...current.steps];

      nextSteps[lastIndex] = {
        blocks: finishStreamingThinking(last.blocks),
        sealed: true,
      };

      return { ...current, steps: nextSteps };
    }
    case "turn_end":
      return current;
    default: {
      const exhaustive: never = event;

      return exhaustive;
    }
  }
}

const turns = new Map<string, LiveTurnState>();
const cliInstallJobs = new Map<string, CliInstallJobState>();
const cliAuthFlows = new Map<string, CliAuthFlowState>();
const watchedAuthFlowIds = new Set<string>();
const UNWATCHED_SETTLED_AUTH_FLOW_TTL_MS = 30_000;
const EMPTY_CLI_INSTALL_JOBS: Readonly<Record<string, CliInstallJobState>> = {};
let cliInstallJobsSnapshot: Readonly<Record<string, CliInstallJobState>> = EMPTY_CLI_INSTALL_JOBS;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function rebuildInstallSnapshot(): void {
  cliInstallJobsSnapshot =
    cliInstallJobs.size === 0 ? EMPTY_CLI_INSTALL_JOBS : Object.fromEntries(cliInstallJobs);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
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

function startTurn(
  sessionId: string,
  runId: RunId,
  options: { triggerText?: string; baselineEntryCount?: number },
): void {
  turns.set(sessionId, {
    runId,
    steps: [],
    ...(options.triggerText !== undefined ? { triggerText: options.triggerText } : {}),
    ...(options.baselineEntryCount !== undefined
      ? { baselineEntryCount: options.baselineEntryCount }
      : {}),
  });
  emit();
}

function applyTurnEvent(sessionId: string, runId: RunId, event: TurnStreamEvent): void {
  const previous = turns.get(sessionId);
  const next = applyTurnEventToState(previous, runId, event);

  if (next !== previous) {
    turns.set(sessionId, next);
    emit();
  }
}

function clearTurn(sessionId: string, expectedRunId?: RunId): void {
  const current = turns.get(sessionId);

  if (current === undefined) {
    return;
  }

  if (expectedRunId !== undefined && current.runId !== expectedRunId) {
    return;
  }

  turns.delete(sessionId);
  emit();
}

function clearAllLiveState(): void {
  let changed = false;

  if (turns.size > 0) {
    turns.clear();
    changed = true;
  }

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

async function resyncActiveCliState(queryClient: QueryClient): Promise<void> {
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

export function useLiveTurn(sessionId: string): LiveTurnState | undefined {
  return useSyncExternalStore(
    subscribe,
    () => turns.get(sessionId),
    () => undefined,
  );
}

function upsertSessionInCache(queryClient: QueryClient, updated: SessionRecord): void {
  queryClient.setQueryData<{ sessions: SessionRecord[] }>(queryKeys.sessions, (prev) => {
    if (prev === undefined) {
      return { sessions: [updated] };
    }

    const exists = prev.sessions.some((item) => item.id === updated.id);
    const next = exists
      ? prev.sessions.map((item) => (item.id === updated.id ? updated : item))
      : [updated, ...prev.sessions];

    return {
      sessions: next.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  });

  queryClient.setQueryData<{ session: SessionRecord; entries: TranscriptEntry[] }>(
    queryKeys.session(updated.id),
    (prev) => (prev === undefined ? prev : { ...prev, session: updated }),
  );
}

function handleDaemonEvent(queryClient: QueryClient, event: DaemonEvent): void {
  switch (event.kind) {
    case "session_updated":
      upsertSessionInCache(queryClient, event.session);
      break;
    case "session_deleted":
      clearTurn(event.sessionId);
      queryClient.setQueryData<{ sessions: SessionRecord[] }>(queryKeys.sessions, (prev) =>
        prev === undefined
          ? prev
          : { sessions: prev.sessions.filter((item) => item.id !== event.sessionId) },
      );
      queryClient.removeQueries({ queryKey: queryKeys.session(event.sessionId) });
      break;
    case "turn_started": {
      const cached = queryClient.getQueryData<{
        session: SessionRecord;
        entries: TranscriptEntry[];
      }>(queryKeys.session(event.sessionId));

      startTurn(event.sessionId, event.runId, {
        ...(event.trigger.kind === "user" ? { triggerText: event.trigger.text } : {}),
        ...(cached !== undefined ? { baselineEntryCount: cached.entries.length } : {}),
      });
      break;
    }
    case "turn_event":
      applyTurnEvent(event.sessionId, event.runId, event.event);
      break;
    case "turn_finished":
      void queryClient
        .invalidateQueries({ queryKey: queryKeys.session(event.sessionId) })
        .finally(() => {
          clearTurn(event.sessionId, event.runId);
        });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile(event.profileId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.cliStatus });
      break;
    case "notification":
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      break;
    case "cli_install_updated":
      upsertCliInstallJob(event.job, queryClient);
      break;
    case "cli_auth_updated":
      upsertCliAuthFlow(event.flow, queryClient);
      break;
    default: {
      const exhaustive: never = event;

      return exhaustive;
    }
  }
}

const SSE_EVENT_NAMES: readonly DaemonEvent["kind"][] = [
  "session_updated",
  "session_deleted",
  "turn_started",
  "turn_event",
  "turn_finished",
  "notification",
  "cli_install_updated",
  "cli_auth_updated",
];

export function useDaemonEvents(enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) {
      clearAllLiveState();

      return;
    }

    const source = new EventSource("/api/events");
    let hasConnectedOnce = false;
    let checkingAuth = false;

    const onConnected = () => {
      if (hasConnectedOnce) {
        turns.clear();
        emit();
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
        void queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
        void queryClient.invalidateQueries({ queryKey: queryKeys.cliStatus });
        void resyncActiveCliState(queryClient);
      }

      hasConnectedOnce = true;
    };

    const onError = () => {
      if (checkingAuth) {
        return;
      }

      checkingAuth = true;
      void getAuthStatus()
        .then(({ authenticated }) => {
          if (!authenticated) {
            queryClient.setQueryData(queryKeys.auth, { authenticated: false });
            void queryClient.invalidateQueries({ queryKey: queryKeys.auth });
          }
        })
        .catch(() => {
          // Daemon may be restarting; EventSource will retry automatically.
        })
        .finally(() => {
          checkingAuth = false;
        });
    };

    const onMessage = (message: MessageEvent<string>) => {
      try {
        const parsed = daemonEventSchema.safeParse(JSON.parse(message.data));

        if (parsed.success) {
          handleDaemonEvent(queryClient, parsed.data);
        }
      } catch {
        // Ignore malformed SSE payloads.
      }
    };

    source.addEventListener("connected", onConnected);
    source.addEventListener("error", onError);

    for (const eventName of SSE_EVENT_NAMES) {
      source.addEventListener(eventName, onMessage);
    }

    return () => {
      source.removeEventListener("connected", onConnected);
      source.removeEventListener("error", onError);

      for (const eventName of SSE_EVENT_NAMES) {
        source.removeEventListener(eventName, onMessage);
      }

      source.close();
    };
  }, [enabled, queryClient]);
}
