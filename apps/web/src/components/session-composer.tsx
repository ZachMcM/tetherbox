import { useState, type KeyboardEvent } from "react";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@tetherbox/ui/components/input-group";
import { usePreferences } from "../lib/preferences.ts";

export function SessionComposer({
  running,
  disabled,
  aborting = false,
  error = null,
  onSend,
  onAbort,
}: {
  running: boolean;
  disabled: boolean;
  aborting?: boolean;
  error?: string | null;
  onSend: (text: string) => Promise<void>;
  onAbort: () => void;
}) {
  const [value, setValue] = useState("");
  const { preferences } = usePreferences();

  const submit = async () => {
    const trimmed = value.trim();

    if (trimmed === "" || disabled) {
      return;
    }

    try {
      await onSend(trimmed);
      setValue("");
    } catch {
      return;
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    const shouldSend =
      preferences.sendShortcut === "enter"
        ? !event.shiftKey && !event.metaKey && !event.ctrlKey
        : event.metaKey || event.ctrlKey;

    if (shouldSend) {
      event.preventDefault();
      void submit();
    }
  };

  const placeholder =
    preferences.sendShortcut === "enter"
      ? "Message this session… (Enter to send, Shift+Enter for newline)"
      : "Message this session… (Cmd+Enter to send)";

  return (
    <div className="border-t border-border bg-background/80 px-4 py-3 backdrop-blur-sm sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <InputGroup className="rounded-3xl bg-muted/60">
          <InputGroupTextarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            rows={2}
            className="max-h-48 min-h-12 resize-none px-4 py-3 text-sm"
            disabled={disabled}
          />
          <InputGroupAddon align="block-end" className="justify-between px-3 pb-2.5">
            <span className="text-xs text-muted-foreground">
              {running ? "Streaming live from Pi session" : "Ready"}
            </span>
            <div className="flex items-center gap-1.5">
              {running && (
                <InputGroupButton
                  variant="destructive"
                  size="sm"
                  onClick={onAbort}
                  disabled={aborting}
                  aria-label="Abort active turn"
                >
                  <SquareIcon className="size-3.5 fill-current" />
                  <span>{aborting ? "Stopping…" : "Stop"}</span>
                </InputGroupButton>
              )}
              <InputGroupButton
                variant="default"
                size="icon-sm"
                onClick={() => void submit()}
                disabled={disabled || value.trim() === ""}
                aria-label="Send message"
              >
                <ArrowUpIcon className="size-4" />
              </InputGroupButton>
            </div>
          </InputGroupAddon>
        </InputGroup>
        {error !== null && <p className="mt-2 px-2 text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
