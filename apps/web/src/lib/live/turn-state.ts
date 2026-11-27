import type { RunId, TurnStreamEvent } from "@tetherbox/core/app";

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

export function applyTurnEventToState(
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
