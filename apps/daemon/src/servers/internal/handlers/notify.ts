import type { NotifyHandlers } from "@tetherbox/core";
import type { TurnRunner } from "../../../sessions/turns.ts";

export function createNotifyHandlers({ turns }: { turns: TurnRunner }): NotifyHandlers {
  return {
    send: (run, input) => turns.notify(run, input),
  };
}
