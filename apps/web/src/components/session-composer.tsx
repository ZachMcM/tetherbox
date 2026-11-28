import { useState, type KeyboardEvent } from "react";
import type { LlmModelOption, ModelSelection } from "@tetherbox/core/app";
import {
  PromptInput,
  PromptInputActions,
  PromptInputFooter,
  PromptInputStop,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@tetherbox/ui/components/prompt-input";
import { isSendShortcutEvent, usePreferences } from "../lib/preferences.ts";
import {
  AttachmentList,
  AttachmentButton,
  useComposerAttachments,
} from "./composer-attachments.tsx";
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
  model: ModelSelection | null;
  onModelChange: (model: ModelSelection) => void;
  onConfigureProviders: () => void;
  onSend: (text: string) => Promise<void>;
  onAbort: () => void;
}) {
  const [value, setValue] = useState("");
  const { preferences } = usePreferences();
  const attachments = useComposerAttachments();

  const submit = async () => {
    const trimmed = value.trim();

    if (trimmed === "" || disabled || model === null) {
      return;
    }

    try {
      // TODO: Upload attachments once turns accept files.
      await onSend(trimmed);
      setValue("");
      attachments.clear();
    } catch {
      return;
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isSendShortcutEvent(event, preferences.sendShortcut)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <div className="border-t border-border bg-background/80 px-4 py-3 backdrop-blur-sm sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <PromptInput onSubmit={() => void submit()} {...attachments.dropTarget}>
          <AttachmentList attachments={attachments.attachments} onRemove={attachments.remove} />
          <PromptInputTextarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={attachments.onPaste}
            placeholder="Reply…"
            rows={2}
            disabled={disabled}
          />
          <PromptInputFooter>
            <PromptInputTools>
              <AttachmentButton onFiles={attachments.add} />
            </PromptInputTools>
            <PromptInputActions>
              <ModelPicker
                variant="ghost"
                side="top"
                align="end"
                models={models}
                value={model}
                disabled={running}
                onChange={onModelChange}
                onConfigureProviders={onConfigureProviders}
              />
              {running ? (
                <PromptInputStop stopping={aborting} onClick={onAbort} />
              ) : (
                <PromptInputSubmit disabled={disabled || value.trim() === "" || model === null} />
              )}
            </PromptInputActions>
          </PromptInputFooter>
        </PromptInput>
        {error !== null && <p className="mt-2 px-2 text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
