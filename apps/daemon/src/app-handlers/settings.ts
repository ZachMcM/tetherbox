import type { SettingsHandlers } from "@tetherbox/core";
import type { DaemonDb } from "../db.ts";

export function createSettingsHandlers({ db }: { db: DaemonDb }): SettingsHandlers {
  return {
    get: () => db.getAppSettings(),
    update: (input) => db.updateAppSettings(input),
  };
}
