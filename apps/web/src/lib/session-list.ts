import type { SessionRecord } from "@tetherbox/core/app";
import type { SessionFilter, UpdatedWithin } from "./preferences.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function updatedSince(updatedWithin: UpdatedWithin, now: Date): number {
  switch (updatedWithin) {
    case "any":
      return Number.NEGATIVE_INFINITY;
    case "today":
      return startOfDay(now);
    case "7d":
      return now.getTime() - 7 * DAY_MS;
    case "30d":
      return now.getTime() - 30 * DAY_MS;
    default: {
      const exhaustive: never = updatedWithin;

      return exhaustive;
    }
  }
}

export function matchesSessionFilter(
  session: SessionRecord,
  filter: SessionFilter,
  now: Date,
): boolean {
  if (filter.profileIds.length > 0 && !filter.profileIds.includes(session.profileId)) {
    return false;
  }

  if (Date.parse(session.updatedAt) < updatedSince(filter.updatedWithin, now)) {
    return false;
  }

  if (filter.statuses.length === 0) {
    return true;
  }

  return filter.statuses.some((status) => {
    switch (status) {
      case "running":
      case "error":
        return session.status === status;
      case "unread":
        return session.unreadAlert;
      default: {
        const exhaustive: never = status;

        return exhaustive;
      }
    }
  });
}

export interface SessionDayGroup {
  label: string;
  sessions: SessionRecord[];
}

export function groupSessionsByDay(
  sessions: readonly SessionRecord[],
  now: Date,
): SessionDayGroup[] {
  const today = startOfDay(now);
  const groups: SessionDayGroup[] = [
    { label: "Today", sessions: [] },
    { label: "Yesterday", sessions: [] },
    { label: "Previous 7 days", sessions: [] },
    { label: "Older", sessions: [] },
  ];
  const sorted = sessions.toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  for (const session of sorted) {
    const updated = Date.parse(session.updatedAt);
    const index =
      updated >= today ? 0 : updated >= today - DAY_MS ? 1 : updated >= today - 7 * DAY_MS ? 2 : 3;

    groups[index]?.sessions.push(session);
  }

  return groups.filter((group) => group.sessions.length > 0);
}
