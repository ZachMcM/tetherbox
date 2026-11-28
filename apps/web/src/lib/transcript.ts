import type { TranscriptEntry } from "@tetherbox/core/app";
import type { LiveAssistantBlock, LiveToolCall, LiveTurnState } from "./live/turn-state.ts";

export type DisplayToolBlock = LiveToolCall & { kind: "tool" };
export type AssistantBlock = LiveAssistantBlock;

export type DisplayItem =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "assistant";
      id: string;
      blocks: AssistantBlock[];
      streaming?: boolean;
    };

interface PersistedToolOutcome {
  result: unknown;
  isError: boolean;
  durationMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractTextParts(items: readonly unknown[]): string[] {
  const parts: string[] = [];

  for (const item of items) {
    if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
      parts.push(item.text);
    }
  }

  return parts;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return extractTextParts(content).join("\n");
}

function extractAssistantBlocks(
  content: unknown,
  toolResults: ReadonlyMap<string, PersistedToolOutcome>,
  liveTools: ReadonlyMap<string, LiveToolCall>,
): AssistantBlock[] {
  if (typeof content === "string") {
    return content.trim() === "" ? [] : [{ kind: "text", text: content }];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  const blocks: AssistantBlock[] = [];

  for (const part of content) {
    if (!isRecord(part) || typeof part.type !== "string") {
      continue;
    }

    if (part.type === "thinking" && typeof part.thinking === "string" && part.thinking !== "") {
      blocks.push({ kind: "thinking", text: part.thinking });
    } else if (part.type === "text" && typeof part.text === "string" && part.text !== "") {
      blocks.push({ kind: "text", text: part.text });
    } else if (
      part.type === "toolCall" &&
      typeof part.id === "string" &&
      typeof part.name === "string"
    ) {
      const outcome = toolResults.get(part.id);

      if (outcome !== undefined) {
        blocks.push({
          kind: "tool",
          toolCallId: part.id,
          toolName: part.name,
          args: part.arguments ?? {},
          result: outcome.result,
          status: outcome.isError ? "error" : "done",
          ...(outcome.durationMs !== undefined ? { durationMs: outcome.durationMs } : {}),
        });
      } else {
        const liveTool = liveTools.get(part.id);

        blocks.push({
          kind: "tool",
          toolCallId: part.id,
          toolName: part.name,
          args: part.arguments ?? {},
          ...(liveTool?.result !== undefined ? { result: liveTool.result } : {}),
          status: liveTool?.status ?? "done",
          ...(liveTool?.durationMs !== undefined ? { durationMs: liveTool.durationMs } : {}),
        });
      }
    }
  }

  return blocks;
}

export function buildDisplayItems(
  entries: readonly TranscriptEntry[],
  liveTurn: LiveTurnState | undefined,
): DisplayItem[] {
  const toolResults = new Map<string, PersistedToolOutcome>();

  for (const entry of entries) {
    if (entry.type !== "message" || !isRecord(entry.message)) {
      continue;
    }

    const message = entry.message;

    if (message.role === "toolResult" && typeof message.toolCallId === "string") {
      toolResults.set(message.toolCallId, {
        result: message.content,
        isError: message.isError === true,
        ...(typeof message.durationMs === "number" ? { durationMs: message.durationMs } : {}),
      });
    }
  }

  const liveTools = new Map<string, LiveToolCall>();

  if (liveTurn !== undefined) {
    for (const step of liveTurn.steps) {
      for (const block of step.blocks) {
        if (block.kind === "tool") {
          liveTools.set(block.toolCallId, block);
        }
      }
    }
  }

  const items: DisplayItem[] = [];
  let persistedUserInLiveTurn = false;
  let persistedStepCount = 0;

  entries.forEach((entry, index) => {
    if (entry.type !== "message" || !isRecord(entry.message)) {
      return;
    }

    const message = entry.message;
    const id = entry.id ?? `entry-${index}`;
    const afterBaseline = liveTurn !== undefined && index >= liveTurn.baselineEntryCount;

    if (message.role === "user") {
      const text = extractTextContent(message.content);

      if (text !== "") {
        items.push({ kind: "user", id, text });

        if (afterBaseline) {
          persistedUserInLiveTurn = true;
        }
      }

      return;
    }

    if (message.role === "assistant") {
      const blocks = extractAssistantBlocks(message.content, toolResults, liveTools);

      if (blocks.length > 0) {
        items.push({ kind: "assistant", id, blocks });

        if (afterBaseline) {
          persistedStepCount += 1;
        }
      }
    }
  });

  if (liveTurn !== undefined) {
    if (liveTurn.triggerText !== undefined && !persistedUserInLiveTurn) {
      items.push({
        kind: "user",
        id: `live-user-${liveTurn.runId}`,
        text: liveTurn.triggerText,
      });
    }

    const unpersistedSteps = liveTurn.steps
      .slice(persistedStepCount)
      .filter((step) => step.blocks.length > 0);

    if (unpersistedSteps.length === 0 && persistedStepCount === 0) {
      items.push({
        kind: "assistant",
        id: `live-assistant-${liveTurn.runId}-0`,
        blocks: [],
        streaming: true,
      });
    } else {
      unpersistedSteps.forEach((step, offset) => {
        const stepNumber = persistedStepCount + offset;

        items.push({
          kind: "assistant",
          id: `live-assistant-${liveTurn.runId}-${stepNumber}`,
          blocks: step.blocks,
          streaming: !step.sealed,
        });
      });
    }
  }

  return items;
}

function extractContentList(value: unknown): readonly unknown[] | undefined {
  if (Array.isArray(value)) {
    return value;
  }

  if (isRecord(value) && Array.isArray(value.content)) {
    return value.content;
  }

  return undefined;
}

export function formatToolPayload(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  const contentList = extractContentList(value);

  if (contentList !== undefined) {
    const texts = extractTextParts(contentList);

    if (texts.length > 0) {
      return texts.join("\n");
    }
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
