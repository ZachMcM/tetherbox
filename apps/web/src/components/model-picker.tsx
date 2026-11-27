import { useMemo, useState } from "react";
import type { LlmModelOption, LlmProvider, ModelRef } from "@tetherbox/core/app";
import { ChevronsUpDownIcon, Settings2Icon } from "lucide-react";
import { Button } from "@tetherbox/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@tetherbox/ui/components/command";
import { Popover, PopoverContent, PopoverTrigger } from "@tetherbox/ui/components/popover";
import { ProviderIcon } from "./provider-icons.tsx";

const PREFERRED_MODEL_IDS: Readonly<Partial<Record<LlmProvider, readonly string[]>>> = {
  anthropic: ["claude-sonnet-4-6", "claude-sonnet-4-5", "claude-opus-4-6"],
  openai: ["gpt-5.2", "gpt-5.1", "gpt-5", "gpt-4.1"],
  "openai-codex": ["gpt-5.6-luna", "gpt-5.3-codex", "gpt-5.2-codex"],
  google: ["gemini-2.5-pro", "gemini-2.5-flash"],
  openrouter: ["~anthropic/claude-sonnet-latest", "anthropic/claude-sonnet-4.5"],
  opencode: ["claude-sonnet-4-5", "gpt-5.2"],
  xai: ["grok-4.7", "grok-4.6"],
  meta: ["muse-spark-1.3", "muse-spark-1.2"],
  "github-copilot": ["claude-sonnet-4.6", "claude-sonnet-4.5", "claude-haiku-4.5"],
};

function modelRefsEqual(a: ModelRef, b: ModelRef): boolean {
  return a.provider === b.provider && a.auth === b.auth && a.id === b.id;
}

function pickSuggestedModel(models: readonly LlmModelOption[]): ModelRef | null {
  const first = models[0];

  if (first === undefined) {
    return null;
  }

  for (const model of models) {
    const preferred = PREFERRED_MODEL_IDS[model.provider];

    if (preferred?.includes(model.id)) {
      return { provider: model.provider, auth: model.auth, id: model.id };
    }
  }

  return { provider: first.provider, auth: first.auth, id: first.id };
}

export function resolveAvailableModel(
  models: readonly LlmModelOption[],
  candidates: readonly (ModelRef | null | undefined)[],
): ModelRef | null {
  for (const candidate of candidates) {
    if (
      candidate !== null &&
      candidate !== undefined &&
      models.some((model) => modelRefsEqual(model, candidate))
    ) {
      return candidate;
    }
  }

  return pickSuggestedModel(models);
}

interface ModelGroup {
  readonly key: string;
  readonly provider: LlmProvider;
  readonly label: string;
  readonly models: readonly LlmModelOption[];
}

export function ModelPicker({
  models,
  value,
  onChange,
  onConfigureProviders,
  disabled = false,
  compact = false,
  side = "bottom",
  placeholder = "Select a model…",
}: {
  models: readonly LlmModelOption[];
  value: ModelRef | null;
  onChange: (model: ModelRef) => void;
  onConfigureProviders?: (() => void) | undefined;
  disabled?: boolean;
  compact?: boolean;
  side?: "top" | "bottom";
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);

  const groups = useMemo<ModelGroup[]>(() => {
    const byKey = new Map<string, ModelGroup & { models: LlmModelOption[] }>();

    for (const model of models) {
      const key = `${model.provider}:${model.auth}`;
      const existing = byKey.get(key);

      if (existing === undefined) {
        byKey.set(key, {
          key,
          provider: model.provider,
          label: `${model.provider} (${model.auth})`,
          models: [model],
        });
      } else {
        existing.models.push(model);
      }
    }

    return [...byKey.values()];
  }, [models]);

  const selectedOption = useMemo(
    () => (value === null ? undefined : models.find((entry) => modelRefsEqual(entry, value))),
    [models, value],
  );

  if (models.length === 0) {
    if (onConfigureProviders !== undefined) {
      return (
        <Button
          type="button"
          variant="outline"
          size={compact ? "xs" : "sm"}
          onClick={onConfigureProviders}
          className="gap-1.5 text-muted-foreground"
        >
          <Settings2Icon className="size-3.5" />
          <span>Configure provider</span>
        </Button>
      );
    }

    return (
      <span className="text-xs text-muted-foreground">
        Connect a provider first to choose a model.
      </span>
    );
  }

  const triggerLabel = selectedOption?.name ?? value?.id ?? placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant={compact ? "ghost" : "outline"}
            size={compact ? "xs" : "default"}
            disabled={disabled}
            className={
              compact
                ? "max-w-56 justify-between gap-1.5 px-2 font-normal text-muted-foreground hover:text-foreground"
                : "w-full justify-between font-normal"
            }
          />
        }
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          {value !== null && <ProviderIcon provider={value.provider} className="size-3.5" />}
          <span className="truncate">{triggerLabel}</span>
          {value !== null && !compact && (
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {value.provider}
            </span>
          )}
        </span>
        <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent side={side} align="start" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Search models…" />
          <CommandList>
            <CommandEmpty>No matching models.</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup
                key={group.key}
                heading={
                  <span className="inline-flex items-center gap-1.5">
                    <ProviderIcon provider={group.provider} className="size-3" />
                    <span>{group.label}</span>
                  </span>
                }
              >
                {group.models.map((option) => {
                  const optionRef: ModelRef = {
                    provider: option.provider,
                    auth: option.auth,
                    id: option.id,
                  };
                  const checked = value !== null && modelRefsEqual(value, optionRef);

                  return (
                    <CommandItem
                      key={`${option.provider}:${option.auth}:${option.id}`}
                      value={`${option.name} ${option.id} ${option.provider} ${option.auth}`}
                      data-checked={checked}
                      onSelect={() => {
                        onChange(optionRef);
                        setOpen(false);
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{option.name}</div>
                        {option.name !== option.id && (
                          <div className="truncate font-mono text-[11px] text-muted-foreground">
                            {option.id}
                          </div>
                        )}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
