import type { ReminderHandlers } from "@tetherbox/core";
import type { ReminderStore } from "../../../jobs/reminders.ts";

export function createReminderHandlers({
  reminders,
}: {
  reminders: ReminderStore;
}): ReminderHandlers {
  return {
    schedule: async (run, input) => reminders.schedule(run.profileId, input, run.sessionId),
    list: (run) => reminders.list(run.profileId),
    cancel: async (run, name) => ({ cancelled: reminders.cancel(run.profileId, name) }),
  };
}
