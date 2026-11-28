import { useSyncExternalStore } from "react";
import type { RunId, TurnStreamEvent } from "@tetherbox/core/app";
import { createListenerSet } from "./listeners.ts";
import { applyTurnEventToState, type LiveTurnState } from "./turn-state.ts";

const turns = new Map<string, LiveTurnState>();
const { subscribe, emit } = createListenerSet();

export function startTurn(
  sessionId: string,
  runId: RunId,
  options: { triggerText?: string; baselineEntryCount: number },
): void {
  turns.set(sessionId, {
    runId,
    steps: [],
    baselineEntryCount: options.baselineEntryCount,
    ...(options.triggerText !== undefined ? { triggerText: options.triggerText } : {}),
  });
  emit();
}

export function applyTurnEvent(sessionId: string, runId: RunId, event: TurnStreamEvent): void {
  const previous = turns.get(sessionId);
  const next = applyTurnEventToState(previous, runId, event);

  if (next !== undefined && next !== previous) {
    turns.set(sessionId, next);
    emit();
  }
}

export function clearTurn(sessionId: string, expectedRunId?: RunId): void {
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

export function clearAllTurns(): void {
  if (turns.size > 0) {
    turns.clear();
    emit();
  }
}

export function useLiveTurn(sessionId: string): LiveTurnState | undefined {
  return useSyncExternalStore(
    subscribe,
    () => turns.get(sessionId),
    () => undefined,
  );
}
