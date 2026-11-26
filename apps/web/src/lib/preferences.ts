import { useSyncExternalStore } from "react";

const STORAGE_KEY = "tetherbox-preferences";

export type TranscriptVerbosity = "compact" | "standard" | "verbose";
export type SendShortcut = "enter" | "mod-enter";

export interface UiPreferences {
  verbosity: TranscriptVerbosity;
  sendShortcut: SendShortcut;
}

const DEFAULT_PREFERENCES: UiPreferences = {
  verbosity: "standard",
  sendShortcut: "enter",
};

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
      verbosity: "verbosity" in parsed ? parseVerbosity(parsed.verbosity) : "standard",
      sendShortcut: "sendShortcut" in parsed ? parseSendShortcut(parsed.sendShortcut) : "enter",
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
