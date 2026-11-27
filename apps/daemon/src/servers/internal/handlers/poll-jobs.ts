import type { PollJobHandlers } from "@tetherbox/core";
import type { Poller } from "../../../jobs/poller.ts";

export function createPollJobHandlers({ poller }: { poller: Poller }): PollJobHandlers {
  return {
    register: async (run, input) => poller.register(run.profileId, input, run.sessionId),
    list: (run) => poller.list(run.profileId),
    cancel: async (run, name) => ({ cancelled: poller.cancel(run.profileId, name) }),
  };
}
