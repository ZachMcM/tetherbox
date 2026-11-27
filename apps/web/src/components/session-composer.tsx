import { useState, type KeyboardEvent } from "react";
import type { LlmModelOption, ModelRef } from "@tetherbox/core/app";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@tetherbox/ui/components/input-group";
import { isSendShortcutEvent, sendShortcutHint, usePreferences } from "../lib/preferences.ts";
import { ModelPicker } from "./model-picker.tsx";

export function SessionComposer({
  running,
  disabled,
  aborting = false,
  error = null,
  models,
  model,
  onModelChange,
  onConfigureProviders,
  onSend,
  onAbort,
}: {
  running: boolean;
  disabled: boolean;
  aborting?: boolean;
  error?: string | null;
  models: readonly LlmModelOption[];
  model: ModelRef | null;
  onModelChange: (model: ModelRef) => void;
  onConfigureProviders: () => void;
  onSend: (text: string) => Promise<void>;
  onAbort: () => void;
}) {
  const [value, setValue] = useState("");
  const { preferences } = usePreferences();

  const submit = async () => {
    const trimmed = value.trim();

    if (trimmed === "" || disabled || model === null) {
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
    if (isSendShortcutEvent(event, preferences.sendShortcut)) {
      event.preventDefault();
      void submit();
    }
  };

  const placeholder = `Message this session… (${sendShortcutHint(preferences.sendShortcut)})`;

  return (
    <div className="border-t border-border bg-background/80 px-4 py-3 backdrop-blur-sm sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <InputGroup className="rounded-xl">
          <InputGroupTextarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            rows={2}
            className="max-h-48 min-h-12 resize-none px-4 py-3 text-sm"
            disabled={disabled}
          />
          <InputGroupAddon align="block-end" className="justify-between gap-2 px-3 pb-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <ModelPicker
                compact
                side="top"
                models={models}
                value={model}
                disabled={running}
                onChange={onModelChange}
                onConfigureProviders={onConfigureProviders}
              />
              {running && (
                <span className="hidden text-xs text-muted-foreground sm:inline">Streaming…</span>
              )}
            </div>
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
                disabled={disabled || value.trim() === "" || model === null}
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
