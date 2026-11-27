import { modelEffortSchema, type LlmModelOption, type ModelSelection } from "@tetherbox/core/app";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@tetherbox/ui/components/select";
import { modelRefsEqual, nearestEffort, PI_DEFAULT_EFFORT } from "../lib/model-selection.ts";

const NO_EFFORT = "default";

export function EffortPicker({
  models,
  value,
  onChange,
  disabled = false,
  compact = false,
}: {
  models: readonly LlmModelOption[];
  value: ModelSelection | null;
  onChange: (model: ModelSelection) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  if (models.length === 0) {
    return null;
  }

  const option = value === null ? undefined : models.find((entry) => modelRefsEqual(entry, value));
  const effortOptions =
    option !== undefined && option.effortOptions.length > 1 ? option.effortOptions : [];
  const levels = effortOptions.map((entry) => entry.level);
  const activeLevel =
    effortOptions.length > 0
      ? nearestEffort(levels, value?.effort ?? PI_DEFAULT_EFFORT)
      : undefined;
  const items = [
    { value: NO_EFFORT, label: "Default" },
    ...effortOptions.map((entry) => ({ value: entry.level, label: entry.label })),
  ];

  return (
    <Select
      items={items}
      value={activeLevel ?? NO_EFFORT}
      disabled={disabled || activeLevel === undefined}
      onValueChange={(next) => {
        const effort = modelEffortSchema.safeParse(next);

        if (value !== null && effort.success) {
          onChange({ ...value, effort: effort.data });
        }
      }}
    >
      <SelectTrigger
        size={compact ? "sm" : "default"}
        aria-label="Reasoning effort"
        className={
          compact
            ? "data-[size=sm]:h-6 border-transparent bg-transparent px-2 text-xs text-muted-foreground hover:text-foreground dark:bg-transparent"
            : undefined
        }
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        <SelectGroup>
          <SelectLabel>Reasoning</SelectLabel>
          {effortOptions.map((entry) => (
            <SelectItem key={entry.level} value={entry.level}>
              {entry.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
