import type { ProfileSummary, SessionRecord } from "@tetherbox/core/app";
import { ListFilterIcon } from "lucide-react";
import { Buddy } from "@tetherbox/ui/components/buddy";
import { Button } from "@tetherbox/ui/components/button";
import { Checkbox } from "@tetherbox/ui/components/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@tetherbox/ui/components/popover";
import { Separator } from "@tetherbox/ui/components/separator";
import { ToggleGroup, ToggleGroupItem } from "@tetherbox/ui/components/toggle-group";
import {
  EMPTY_SESSION_FILTER,
  SESSION_STATUS_FILTERS,
  UPDATED_WITHIN_OPTIONS,
  type SessionFilter,
  type SessionStatusFilter,
  type UpdatedWithin,
} from "../lib/preferences.ts";

export const UPDATED_WITHIN_LABELS: Record<UpdatedWithin, string> = {
  any: "Any",
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
};

export const STATUS_FILTER_LABELS: Record<SessionStatusFilter, string> = {
  running: "Running",
  unread: "Unread",
  error: "Failed",
};

function activeFilterCount(filter: SessionFilter): number {
  return (
    filter.profileIds.length + (filter.updatedWithin === "any" ? 0 : 1) + filter.statuses.length
  );
}

function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];
}

function FilterHeading({ children }: { children: string }) {
  return (
    <div className="px-1 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">{children}</div>
  );
}

export function SessionFilterPopover({
  profiles,
  sessions,
  filter,
  visibleCount,
  onChange,
}: {
  profiles: readonly ProfileSummary[];
  sessions: readonly SessionRecord[];
  filter: SessionFilter;
  visibleCount: number;
  onChange: (next: SessionFilter) => void;
}) {
  const count = activeFilterCount(filter);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Filter conversations"
            className="relative text-sidebar-foreground/75"
          />
        }
      >
        <ListFilterIcon />
        {count > 0 && (
          <span className="absolute top-0.5 right-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-primary px-0.5 text-[9px] font-semibold text-primary-foreground tabular-nums">
            {count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-0 p-2">
        <FilterHeading>Profile</FilterHeading>
        {profiles.map((profile) => (
          <label
            key={profile.id}
            className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-1 text-sm hover:bg-muted"
          >
            <Checkbox
              checked={filter.profileIds.includes(profile.id)}
              onCheckedChange={() =>
                onChange({ ...filter, profileIds: toggle(filter.profileIds, profile.id) })
              }
            />
            <Buddy {...profile.buddy} size={20} />
            <span className="flex-1 truncate">{profile.name}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {sessions.filter((session) => session.profileId === profile.id).length}
            </span>
          </label>
        ))}

        <Separator className="my-2" />
        <FilterHeading>Updated</FilterHeading>
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          className="w-full"
          value={[filter.updatedWithin]}
          onValueChange={(next) => {
            const updatedWithin = UPDATED_WITHIN_OPTIONS.find((option) => option === next[0]);

            if (updatedWithin !== undefined) {
              onChange({ ...filter, updatedWithin });
            }
          }}
        >
          {UPDATED_WITHIN_OPTIONS.map((option) => (
            <ToggleGroupItem key={option} value={option} className="flex-1">
              {UPDATED_WITHIN_LABELS[option]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <Separator className="my-2" />
        <FilterHeading>Status</FilterHeading>
        {SESSION_STATUS_FILTERS.map((status) => (
          <label
            key={status}
            className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-1 text-sm hover:bg-muted"
          >
            <Checkbox
              checked={filter.statuses.includes(status)}
              onCheckedChange={() =>
                onChange({ ...filter, statuses: toggle(filter.statuses, status) })
              }
            />
            <span>{STATUS_FILTER_LABELS[status]}</span>
          </label>
        ))}

        <Separator className="my-2" />
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted-foreground tabular-nums">
            {visibleCount} of {sessions.length}
          </span>
          <Button
            variant="ghost"
            size="xs"
            disabled={count === 0}
            onClick={() => onChange(EMPTY_SESSION_FILTER)}
          >
            Reset
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
