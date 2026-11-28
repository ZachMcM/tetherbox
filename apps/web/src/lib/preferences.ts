import { useSyncExternalStore } from "react";

const STORAGE_KEY = "tetherbox-preferences";

export type TranscriptVerbosity = "compact" | "standard" | "verbose";
export type SendShortcut = "enter" | "mod-enter";

export const UPDATED_WITHIN_OPTIONS = ["any", "today", "7d", "30d"] as const;
export type UpdatedWithin = (typeof UPDATED_WITHIN_OPTIONS)[number];

export const SESSION_STATUS_FILTERS = ["running", "unread", "error"] as const;
export type SessionStatusFilter = (typeof SESSION_STATUS_FILTERS)[number];

export interface SessionFilter {
  profileIds: string[];
  updatedWithin: UpdatedWithin;
  statuses: SessionStatusFilter[];
}

export const EMPTY_SESSION_FILTER: SessionFilter = {
  profileIds: [],
  updatedWithin: "any",
  statuses: [],
};

export interface UiPreferences {
  verbosity: TranscriptVerbosity;
  sendShortcut: SendShortcut;
  sessionFilter: SessionFilter;
}

const DEFAULT_PREFERENCES: UiPreferences = {
  verbosity: "standard",
  sendShortcut: "enter",
  sessionFilter: EMPTY_SESSION_FILTER,
};

function isUpdatedWithin(value: unknown): value is UpdatedWithin {
  return UPDATED_WITHIN_OPTIONS.some((option) => option === value);
}

function isSessionStatusFilter(value: unknown): value is SessionStatusFilter {
  return SESSION_STATUS_FILTERS.some((option) => option === value);
}

function parseSessionFilter(value: unknown): SessionFilter {
  if (typeof value !== "object" || value === null) {
    return EMPTY_SESSION_FILTER;
  }

  const profileIds =
    "profileIds" in value && Array.isArray(value.profileIds)
      ? value.profileIds.filter((id): id is string => typeof id === "string")
      : [];
  const updatedWithin =
    "updatedWithin" in value && isUpdatedWithin(value.updatedWithin) ? value.updatedWithin : "any";
  const statuses =
    "statuses" in value && Array.isArray(value.statuses)
      ? value.statuses.filter(isSessionStatusFilter)
      : [];

  return { profileIds, updatedWithin, statuses };
}

function parseVerbosity(value: unknown): TranscriptVerbosity {
  return value === "compact" || value === "standard" || value === "verbose"
    ? value
    : DEFAULT_PREFERENCES.verbosity;
}

function parseSendShortcut(value: unknown): SendShortcut {
  return value === "enter" || value === "mod-enter" ? value : DEFAULT_PREFERENCES.sendShortcut;
}

function readPreferences(): UiPreferences {
  if (typeof window === "undefined") {
    return DEFAULT_PREFERENCES;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (raw === null) {
      return DEFAULT_PREFERENCES;
    }

    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== "object" || parsed === null) {
      return DEFAULT_PREFERENCES;
    }

    return {
      verbosity: parseVerbosity("verbosity" in parsed ? parsed.verbosity : undefined),
      sendShortcut: parseSendShortcut("sendShortcut" in parsed ? parsed.sendShortcut : undefined),
      sessionFilter: parseSessionFilter(
        "sessionFilter" in parsed ? parsed.sessionFilter : undefined,
      ),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

let currentPreferences: UiPreferences = readPreferences();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function updatePreferences(patch: Partial<UiPreferences>): void {
  currentPreferences = { ...currentPreferences, ...patch };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentPreferences));
  } catch {
    // Ignore storage write errors in private browsing.
  }

  for (const listener of listeners) {
    listener();
  }
}

export function isSendShortcutEvent(
  event: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  shortcut: SendShortcut,
): boolean {
  if (event.key !== "Enter") {
    return false;
  }

  return shortcut === "enter"
    ? !event.shiftKey && !event.metaKey && !event.ctrlKey
    : event.metaKey || event.ctrlKey;
}

export function usePreferences(): {
  preferences: UiPreferences;
  updatePreferences: (patch: Partial<UiPreferences>) => void;
} {
  const preferences = useSyncExternalStore(
    subscribe,
    () => currentPreferences,
    () => DEFAULT_PREFERENCES,
  );

  return { preferences, updatePreferences };
}
