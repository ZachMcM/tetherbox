import { type StarterConfig, type StarterSummary } from "@tetherbox/core/app";
import { CheckCircle2Icon } from "lucide-react";
import { Checkbox } from "@tetherbox/ui/components/checkbox";
import { Field, FieldLabel } from "@tetherbox/ui/components/field";
import { StarterIcon } from "../starter-icons.tsx";
import { STARTER_CATEGORY_ORDER, type StarterReadiness } from "../../lib/starter-readiness.ts";
import { StarterBadges } from "./starter-badges.tsx";

export function StarterSelectionFields({
  idPrefix,
  starters,
  selectedStarters,
  starterConfig,
  readinessById,
  onChange,
}: {
  idPrefix: string;
  starters: readonly StarterSummary[];
  selectedStarters: readonly string[];
  starterConfig: StarterConfig;
  readinessById: ReadonlyMap<string, StarterReadiness>;
  onChange: (next: { starters: string[]; starterConfig: StarterConfig }) => void;
}) {
  const selectedSet = new Set(selectedStarters);

  const toggleStarter = (starterId: string, checked: boolean) => {
    const nextSet = new Set(selectedStarters);

    if (checked) {
      nextSet.add(starterId);
    } else {
      nextSet.delete(starterId);
    }

    const nextStarters = starters
      .filter((starter) => nextSet.has(starter.id))
      .map((starter) => starter.id);
    const nextConfig: Record<string, Record<string, string>> = {};

    for (const [id, values] of Object.entries(starterConfig)) {
      if (nextSet.has(id)) {
        nextConfig[id] = values;
      }
    }

    onChange({ starters: nextStarters, starterConfig: nextConfig });
  };

  return (
    <div className="space-y-3">
      {STARTER_CATEGORY_ORDER.map(({ category, label }) => {
        const group = starters.filter((starter) => starter.category === category);

        if (group.length === 0) {
          return null;
        }

        return (
          <div key={category} className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">{label}</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {group.map((starter) => {
                const checked = selectedSet.has(starter.id);
                const checkboxId = `${idPrefix}-starter-${starter.id}`;
                const readiness = readinessById.get(starter.id);
                const vmReady =
                  readiness !== undefined && readiness.hasVmRequirements && readiness.isVmReady;

                return (
                  <FieldLabel key={starter.id} htmlFor={checkboxId} className="cursor-pointer">
                    <Field orientation="horizontal">
                      <Checkbox
                        id={checkboxId}
                        checked={checked}
                        onCheckedChange={(value) => toggleStarter(starter.id, value)}
                      />
                      <StarterIcon starter={starter} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {starter.name}
                      </span>
                      {vmReady && (
                        <CheckCircle2Icon
                          className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                          aria-label="Ready on this VM"
                        />
                      )}
                      <StarterBadges starter={starter} />
                    </Field>
                  </FieldLabel>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
