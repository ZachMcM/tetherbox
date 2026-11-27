import type { SettingsHandlers } from "@tetherbox/core";
import type { AppSettingsTable } from "../../../db/settings.ts";

export function createSettingsHandlers({
  settings,
}: {
  settings: AppSettingsTable;
}): SettingsHandlers {
  return {
    get: () => settings.get(),
    update: (input) => settings.update(input),
  };
}
