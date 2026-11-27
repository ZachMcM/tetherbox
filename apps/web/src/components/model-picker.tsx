import { useMemo, useState, type KeyboardEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  LlmModelOption,
  LlmProvider,
  ModelEffort,
  ModelRef,
  ModelSelection,
} from "@tetherbox/core/app";
import { CheckIcon, ChevronDownIcon, SearchIcon, Settings2Icon, StarIcon } from "lucide-react";
import { Button } from "@tetherbox/ui/components/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@tetherbox/ui/components/input-group";
import { Kbd } from "@tetherbox/ui/components/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@tetherbox/ui/components/popover";
import { Separator } from "@tetherbox/ui/components/separator";
import { toast } from "@tetherbox/ui/components/toast";
import { Tabs, TabsList, TabsTrigger } from "@tetherbox/ui/components/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@tetherbox/ui/components/tooltip";
import { cn } from "@tetherbox/ui/lib/utils";
import { appClient, expectOk, queryKeys } from "../lib/api.ts";
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

const EFFORT_ORDER: readonly ModelEffort[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const PI_DEFAULT_EFFORT: ModelEffort = "medium";

const FAVORITES_TAB = "favorites";

const SHORTCUT_MODIFIER = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl+";

function modelRefsEqual(a: ModelRef, b: ModelRef): boolean {
  return a.provider === b.provider && a.auth === b.auth && a.id === b.id;
}

function modelKey(model: ModelRef): string {
  return `${model.provider}:${model.auth}:${model.id}`;
}

function groupKey(model: Pick<ModelRef, "provider" | "auth">): string {
  return `${model.provider}:${model.auth}`;
}

function nearestEffort(
  levels: readonly ModelEffort[],
  wanted: ModelEffort,
): ModelEffort | undefined {
  if (levels.includes(wanted)) {
    return wanted;
  }

  const wantedIndex = EFFORT_ORDER.indexOf(wanted);
  const above = EFFORT_ORDER.slice(wantedIndex + 1).find((level) => levels.includes(level));

  return above ?? EFFORT_ORDER.slice(0, wantedIndex).findLast((level) => levels.includes(level));
}

function effortLevelsOf(option: LlmModelOption): ModelEffort[] {
  return option.effortOptions.map((entry) => entry.level);
}

function selectionFor(
  option: LlmModelOption,
  preferredEffort: ModelEffort | undefined,
): ModelSelection {
  const ref = { provider: option.provider, auth: option.auth, id: option.id };

  if (option.effortOptions.length <= 1) {
    return ref;
  }

  const effort = nearestEffort(effortLevelsOf(option), preferredEffort ?? PI_DEFAULT_EFFORT);

  return effort !== undefined ? { ...ref, effort } : ref;
}

function pickSuggestedModel(models: readonly LlmModelOption[]): ModelSelection | null {
  const first = models[0];

  if (first === undefined) {
    return null;
  }

  for (const model of models) {
    const preferred = PREFERRED_MODEL_IDS[model.provider];

    if (preferred?.includes(model.id)) {
      return selectionFor(model, undefined);
    }
  }

  return selectionFor(first, undefined);
}

export function resolveAvailableModel(
  models: readonly LlmModelOption[],
  candidates: readonly (ModelSelection | null | undefined)[],
): ModelSelection | null {
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

function matchesSearch(model: LlmModelOption, query: string): boolean {
  return `${model.name} ${model.id} ${model.provider} ${model.auth}`.toLowerCase().includes(query);
}

interface ModelGroup {
  readonly key: string;
  readonly provider: LlmProvider;
  readonly label: string;
  readonly items: LlmModelOption[];
}

function groupModels(models: readonly LlmModelOption[]): ModelGroup[] {
  const byKey = new Map<string, ModelGroup>();

  for (const model of models) {
    const key = groupKey(model);
    const existing = byKey.get(key);

    if (existing === undefined) {
      byKey.set(key, {
        key,
        provider: model.provider,
        label: `${model.provider} (${model.auth})`,
        items: [model],
      });
    } else {
      existing.items.push(model);
    }
  }

  return [...byKey.values()];
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
  value: ModelSelection | null;
  onChange: (model: ModelSelection) => void;
  onConfigureProviders?: (() => void) | undefined;
  disabled?: boolean;
  compact?: boolean;
  side?: "top" | "bottom";
  placeholder?: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [chosenTab, setChosenTab] = useState<string | null>(null);

  const groups = useMemo(() => groupModels(models), [models]);
  const favorites = models.filter((model) => model.favorite);

  const favoriteMutation = useMutation({
    mutationFn: async ({ model, favorite }: { model: ModelRef; favorite: boolean }) => {
      const json = { provider: model.provider, auth: model.auth, id: model.id };

      await expectOk(
        favorite
          ? await appClient.llm.favorites.$put({ json })
          : await appClient.llm.favorites.$delete({ json }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.llmModels });
    },
    onError: (error) => {
      toast.add({ type: "error", title: "Could not update favorites", description: error.message });
    },
  });

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

  const selectedOption =
    value === null ? undefined : models.find((entry) => modelRefsEqual(entry, value));
  const defaultTab =
    selectedOption !== undefined
      ? groupKey(selectedOption)
      : favorites.length > 0
        ? FAVORITES_TAB
        : (groups[0]?.key ?? FAVORITES_TAB);
  const activeTab = chosenTab ?? defaultTab;
  const query = search.trim().toLowerCase();
  const searching = query !== "";
  const listedModels = searching
    ? models.filter((model) => matchesSearch(model, query))
    : activeTab === FAVORITES_TAB
      ? favorites
      : (groups.find((group) => group.key === activeTab)?.items ?? []);
  const effortOptions = selectedOption?.effortOptions ?? [];
  const effortLevels = selectedOption !== undefined ? effortLevelsOf(selectedOption) : [];
  const activeLevel =
    effortOptions.length > 1
      ? nearestEffort(effortLevels, value?.effort ?? PI_DEFAULT_EFFORT)
      : undefined;
  const activeEffort = effortOptions.find((entry) => entry.level === activeLevel);
  const defaultEffortLevel = nearestEffort(effortLevels, PI_DEFAULT_EFFORT);
  const emptyMessage = searching
    ? "No matching models."
    : activeTab === FAVORITES_TAB
      ? "Star a model to pin it here."
      : "No models.";

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);

    if (!nextOpen) {
      setSearch("");
      setChosenTab(null);
    }
  };

  const selectModel = (option: LlmModelOption) => {
    onChange(selectionFor(option, value?.effort));

    if (option.effortOptions.length <= 1) {
      handleOpenChange(false);
    }
  };

  const selectEffort = (effort: ModelEffort) => {
    if (value !== null) {
      onChange({ ...value, effort });
      handleOpenChange(false);
    }
  };

  const handleShortcut = (event: KeyboardEvent<HTMLDivElement>) => {
    if (searching || !(event.metaKey || event.ctrlKey) || !/^[1-9]$/.test(event.key)) {
      return;
    }

    const option = listedModels[Number(event.key) - 1];

    if (option !== undefined) {
      event.preventDefault();
      selectModel(option);
    }
  };

  return (
    // Base UI renders focus-guard spans beside the open trigger; this box keeps them from
    // changing the parent's `space-y-*` margins.
    <div>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant={compact ? "ghost" : "outline"}
              size={compact ? "xs" : "default"}
              disabled={disabled}
              className={
                compact
                  ? "max-w-64 justify-between gap-1.5 px-2 font-normal text-muted-foreground hover:text-foreground"
                  : "w-full justify-between font-normal"
              }
            />
          }
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {value !== null && <ProviderIcon provider={value.provider} className="size-3.5" />}
            <span className="truncate">{selectedOption?.name ?? value?.id ?? placeholder}</span>
            {activeEffort !== undefined && (
              <span className="shrink-0 text-muted-foreground">· {activeEffort.label}</span>
            )}
          </span>
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent
          side={side}
          align="start"
          className="h-80 w-[min(38rem,calc(100vw-2rem))] flex-row gap-0 p-0"
          onKeyDown={handleShortcut}
        >
          <Tabs
            orientation="vertical"
            value={searching ? null : activeTab}
            onValueChange={(next) => {
              setChosenTab(String(next));
              setSearch("");
            }}
            className="shrink-0 gap-0 border-r border-border p-1.5"
          >
            <TabsList variant="line" className="gap-2">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <TabsTrigger value={FAVORITES_TAB} aria-label="Favorites" className="size-10" />
                  }
                >
                  <StarIcon className="size-5" />
                </TooltipTrigger>
                <TooltipContent side="right">Favorites</TooltipContent>
              </Tooltip>
              <Separator className="w-6" />
              {groups.map((group) => (
                <Tooltip key={group.key}>
                  <TooltipTrigger
                    render={
                      <TabsTrigger value={group.key} aria-label={group.label} className="size-10" />
                    }
                  >
                    <ProviderIcon provider={group.provider} className="size-5" />
                  </TooltipTrigger>
                  <TooltipContent side="right">{group.label}</TooltipContent>
                </Tooltip>
              ))}
            </TabsList>
          </Tabs>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="p-2">
              <InputGroup>
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search models…"
                  autoFocus
                />
              </InputGroup>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
              {listedModels.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">{emptyMessage}</p>
              ) : (
                listedModels.map((option, index) => {
                  const checked = value !== null && modelRefsEqual(option, value);

                  return (
                    <div key={modelKey(option)} className="group/model flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        title={option.id}
                        aria-pressed={checked}
                        onClick={() => selectModel(option)}
                        className="min-w-0 flex-1 justify-start gap-2 font-normal"
                      >
                        <ProviderIcon provider={option.provider} className="size-4" />
                        <span className="truncate">{option.name}</span>
                        {checked && <CheckIcon className="text-muted-foreground" />}
                        {!searching && index < 9 && (
                          <Kbd className="ml-auto">
                            {SHORTCUT_MODIFIER}
                            {index + 1}
                          </Kbd>
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={option.favorite ? "Remove from favorites" : "Add to favorites"}
                        aria-pressed={option.favorite}
                        onClick={() =>
                          favoriteMutation.mutate({ model: option, favorite: !option.favorite })
                        }
                        className={cn(
                          "text-muted-foreground",
                          !option.favorite &&
                            "opacity-0 group-hover/model:opacity-100 focus-visible:opacity-100",
                        )}
                      >
                        <StarIcon
                          className={cn(option.favorite && "fill-current text-foreground")}
                        />
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {activeEffort !== undefined && (
            <div className="flex w-40 shrink-0 flex-col border-l border-border p-1.5">
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Reasoning</div>
              {effortOptions.map((entry) => (
                <Button
                  key={entry.level}
                  type="button"
                  variant="ghost"
                  aria-pressed={entry === activeEffort}
                  onClick={() => selectEffort(entry.level)}
                  className="justify-start gap-2 font-normal"
                >
                  <span className="flex-1 text-left">{entry.label}</span>
                  {entry.level === defaultEffortLevel && (
                    <span className="text-xs text-muted-foreground">Default</span>
                  )}
                  {entry === activeEffort && <CheckIcon />}
                </Button>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
