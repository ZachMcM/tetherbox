import type { ProfileId, RunId, SessionId } from "../../ids.ts";

export interface RunContext {
  runId: RunId;
  profileId: ProfileId;
  sessionId: SessionId;
}

export interface InternalEnv {
  Variables: { run: RunContext };
}
