import {
  AlertCircleIcon,
  BrainIcon,
  CheckCircle2Icon,
  MessageSquareIcon,
  WrenchIcon,
} from "lucide-react";
import type { SessionRecord } from "@tetherbox/core/app";
import { Alert, AlertDescription, AlertTitle } from "@tetherbox/ui/components/alert";
import { Bubble, BubbleContent } from "@tetherbox/ui/components/bubble";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@tetherbox/ui/components/empty";
import { Message, MessageContent } from "@tetherbox/ui/components/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@tetherbox/ui/components/message-scroller";
import { Spinner } from "@tetherbox/ui/components/spinner";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@tetherbox/ui/components/trace";
import { usePreferences, type TranscriptVerbosity } from "../lib/preferences.ts";
import {
  formatToolPayload,
  type AssistantBlock,
  type DisplayItem,
  type DisplayToolBlock,
} from "../lib/transcript.ts";
import { Markdown } from "./markdown.tsx";

function ToolStatusIcon({ status }: { status: DisplayToolBlock["status"] }) {
  switch (status) {
    case "running":
      return <Spinner className="size-3.5" />;
    case "error":
      return <AlertCircleIcon className="size-3.5" />;
    case "done":
      return <WrenchIcon className="size-3.5" />;
    default: {
      const exhaustive: never = status;

      return exhaustive;
    }
  }
}

function ToolTraceItem({ tool, defaultOpen }: { tool: DisplayToolBlock; defaultOpen: boolean }) {
  const status = tool.status === "done" ? undefined : tool.status;
  const duration =
    tool.durationMs !== undefined ? `${(tool.durationMs / 1000).toFixed(1)}s` : undefined;

  return (
    <TraceCollapsible key={defaultOpen ? "open" : "closed"} defaultOpen={defaultOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine {...(status !== undefined ? { status } : {})}>
          <TraceIcon>
            <ToolStatusIcon status={tool.status} />
          </TraceIcon>
          <TraceTitle>{tool.toolName}</TraceTitle>
          {duration !== undefined && <TraceDescription>{duration}</TraceDescription>}
          {tool.status === "done" && (
            <TraceIcon>
              <CheckCircle2Icon className="size-3.5 text-muted-foreground/70" />
            </TraceIcon>
          )}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <div className="space-y-2 text-xs">
          <div>
            <div className="mb-1 font-medium text-foreground/80">Input</div>
            <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-2.5 font-mono text-xs text-foreground">
              {formatToolPayload(tool.args)}
            </pre>
          </div>
          {tool.result !== undefined && (
            <div>
              <div className="mb-1 font-medium text-foreground/80">Output</div>
              <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-2.5 font-mono text-xs text-foreground">
                {formatToolPayload(tool.result)}
              </pre>
            </div>
          )}
        </div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function AssistantBlockView({
  block,
  verbosity,
}: {
  block: AssistantBlock;
  verbosity: TranscriptVerbosity;
}) {
  const expandTraces = verbosity === "verbose";

  switch (block.kind) {
    case "thinking":
      if (verbosity === "compact") {
        return null;
      }

      return (
        <Trace>
          <TraceCollapsible key={expandTraces ? "open" : "closed"} defaultOpen={expandTraces}>
            <TraceCollapsibleTrigger>
              <TraceLine {...(block.streaming ? { status: "running" as const } : {})}>
                <TraceIcon>
                  <BrainIcon className="size-3.5" />
                </TraceIcon>
                <TraceTitle>{block.streaming ? "Thinking…" : "Thought process"}</TraceTitle>
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent>
              <div className="whitespace-pre-wrap text-xs">{block.text}</div>
            </TraceCollapsibleContent>
          </TraceCollapsible>
        </Trace>
      );
    case "tool":
      return (
        <Trace>
          <ToolTraceItem tool={block} defaultOpen={expandTraces} />
        </Trace>
      );
    case "text":
      return <Markdown content={block.text} />;
    default: {
      const exhaustive: never = block;

      return exhaustive;
    }
  }
}

function RunningIndicator() {
  return (
    <Trace>
      <TraceLine status="running">
        <TraceIcon>
          <Spinner className="size-3.5" />
        </TraceIcon>
        <TraceTitle>Running…</TraceTitle>
      </TraceLine>
    </Trace>
  );
}

export function SessionTranscript({
  session,
  items,
}: {
  session: SessionRecord;
  items: readonly DisplayItem[];
}) {
  const { preferences } = usePreferences();

  if (items.length === 0 && session.status !== "running") {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Empty className="max-w-md border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquareIcon />
            </EmptyMedia>
            <EmptyTitle>Start a conversation</EmptyTitle>
            <EmptyDescription>
              Send a message below to start a Pi session inside this profile.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <MessageScrollerProvider>
      <MessageScroller className="flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
            {items.length === 0 && session.status === "running" && (
              <MessageScrollerItem>
                <Message align="start">
                  <MessageContent>
                    <RunningIndicator />
                  </MessageContent>
                </Message>
              </MessageScrollerItem>
            )}

            {items.map((item) => {
              if (item.kind === "user") {
                return (
                  <MessageScrollerItem key={item.id}>
                    <Message align="end">
                      <MessageContent>
                        <Bubble variant="secondary" align="end">
                          <BubbleContent className="whitespace-pre-wrap">{item.text}</BubbleContent>
                        </Bubble>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                );
              }

              const visibleBlocks =
                preferences.verbosity === "compact"
                  ? item.blocks.filter((block) => block.kind !== "thinking")
                  : item.blocks;

              if (visibleBlocks.length === 0 && !item.streaming) {
                return null;
              }

              return (
                <MessageScrollerItem key={item.id}>
                  <Message align="start">
                    <MessageContent className="gap-3">
                      {visibleBlocks.length === 0 ? (
                        <RunningIndicator />
                      ) : (
                        visibleBlocks.map((block, index) => (
                          <AssistantBlockView
                            key={
                              block.kind === "tool" ? block.toolCallId : `${block.kind}-${index}`
                            }
                            block={block}
                            verbosity={preferences.verbosity}
                          />
                        ))
                      )}
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              );
            })}

            {session.status === "error" && session.errorMessage !== null && (
              <MessageScrollerItem>
                <Alert variant="destructive">
                  <AlertCircleIcon className="size-4" />
                  <AlertTitle>Turn failed</AlertTitle>
                  <AlertDescription>{session.errorMessage}</AlertDescription>
                </Alert>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
