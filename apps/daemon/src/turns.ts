import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  RpcError,
  runIdSchema,
  sessionIdSchema,
  type ModelRef,
  type NotifyInput,
  type ProfileId,
  type ProfileIssue,
  type RunContext,
  type RunId,
  type SessionId,
  type TurnModelAuth,
  type TurnTrigger,
} from "@tetherbox/core";
import { runAgent } from "./agent-spawner.ts";
import type { DaemonConfig } from "./config.ts";
import type { DaemonDb } from "./db.ts";
import type { DaemonEventBus } from "./events.ts";
import type { LlmOAuth } from "./llm-oauth.ts";
import type { LoadedProfile, ProfileRegistry } from "./profiles.ts";
import { sessionTranscriptPath } from "./transcript.ts";

const MAX_SESSION_TITLE_CHARS = 80;

export const DEFAULT_SESSION_TITLE = "New session";

export function sessionTitleFromText(text: string): string {
  const compact = text.trim().replace(/\s+/g, " ");

  if (compact.length <= MAX_SESSION_TITLE_CHARS) {
    return compact;
  }

  return `${compact.slice(0, MAX_SESSION_TITLE_CHARS - 1).trimEnd()}…`;
}

interface ActiveRun {
  context: RunContext;
  runToken: string;
  controller: AbortController;
}

export interface TurnRunnerDeps {
  config: DaemonConfig;
  registry: ProfileRegistry;
  llmOAuth: LlmOAuth;
  db: DaemonDb;
  events: DaemonEventBus;
  onProfileReloaded(profile: LoadedProfile): ProfileIssue[];
}

function deriveSessionTitle(trigger: TurnTrigger): string {
  switch (trigger.kind) {
    case "user":
      return sessionTitleFromText(trigger.text);
    case "cron":
      return `Cron: ${trigger.job}`;
    case "webhook":
      return `Webhook: ${trigger.hook}`;
    case "poll":
      return `Poll: ${trigger.job}`;
    case "reminder":
      return `Reminder: ${trigger.name}`;
    default: {
      const exhaustive: never = trigger;

      return exhaustive;
    }
  }
}

/**
 * Runs agent turns sequentially within each session while allowing separate sessions to run in
 * parallel. Live Pi events stream over `events`, and session state is persisted in SQLite.
 */
export class TurnRunner {
  readonly #deps: TurnRunnerDeps;
  readonly #runsByToken = new Map<string, ActiveRun>();
  readonly #runsById = new Map<RunId, ActiveRun>();
  readonly #activeBySession = new Map<SessionId, ActiveRun>();
  readonly #queues = new Map<SessionId, Promise<void>>();
  readonly #queuedProfile = new Map<SessionId, ProfileId>();
  readonly #deletedSessions = new Set<SessionId>();
  readonly #deletingProfiles = new Set<ProfileId>();
  #closing = false;

  constructor(deps: TurnRunnerDeps) {
    this.#deps = deps;
  }

  enqueue(profileId: ProfileId, trigger: TurnTrigger, existingSessionId?: SessionId): SessionId {
    if (this.#closing || this.#deletingProfiles.has(profileId)) {
      throw new RpcError(409, `profile "${profileId}" is not accepting turns`);
    }

    if (existingSessionId !== undefined && this.#deletedSessions.has(existingSessionId)) {
      throw new RpcError(404, `session "${existingSessionId}" was deleted`);
    }

    const sessionId = existingSessionId ?? sessionIdSchema.parse(randomUUID());
    const existing = this.#deps.db.getSession(sessionId);

    if (existing !== undefined && existing.profileId !== profileId) {
      throw new RpcError(
        409,
        `session "${sessionId}" belongs to profile "${existing.profileId}", not "${profileId}"`,
      );
    }

    if (existing === undefined) {
      const created = this.#deps.db.createSession({
        id: sessionId,
        profileId,
        title: deriveSessionTitle(trigger),
        triggerKind: trigger.kind,
      });

      this.#deps.events.emit({ kind: "session_updated", session: created });
    }

    const previous = this.#queues.get(sessionId) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        if (this.#isCancelled(profileId, sessionId)) {
          return;
        }

        await this.#run(profileId, sessionId, trigger);
      })
      .catch((error: unknown) => {
        console.error(`turn for profile ${profileId} session ${sessionId} failed`, error);
      })
      .finally(() => {
        if (this.#queues.get(sessionId) === next) {
          this.#queues.delete(sessionId);
          this.#queuedProfile.delete(sessionId);
        }
      });

    this.#queues.set(sessionId, next);
    this.#queuedProfile.set(sessionId, profileId);

    return sessionId;
  }

  abort(sessionId: SessionId): boolean {
    const run = this.#activeBySession.get(sessionId);

    if (run === undefined) {
      return false;
    }

    this.#revokeRun(run);
    run.controller.abort();

    return true;
  }

  async cancelSession(sessionId: SessionId): Promise<void> {
    this.#deletedSessions.add(sessionId);
    this.abort(sessionId);

    const pending = this.#queues.get(sessionId);

    if (pending !== undefined) {
      await pending;
    }
  }

  async cancelProfile(profileId: ProfileId, sessionIds: readonly SessionId[]): Promise<void> {
    this.#deletingProfiles.add(profileId);

    const targets = new Set<SessionId>(sessionIds);

    for (const [sessionId, queuedProfileId] of this.#queuedProfile) {
      if (queuedProfileId === profileId) {
        targets.add(sessionId);
      }
    }

    for (const [sessionId, run] of this.#activeBySession) {
      if (run.context.profileId === profileId) {
        targets.add(sessionId);
      }
    }

    await Promise.all([...targets].map((sessionId) => this.cancelSession(sessionId)));
  }

  finishProfileDeletion(profileId: ProfileId): void {
    this.#deletingProfiles.delete(profileId);
  }

  async shutdown(): Promise<void> {
    this.#closing = true;

    for (const sessionId of this.#activeBySession.keys()) {
      this.abort(sessionId);
    }

    await Promise.allSettled(this.#queues.values());
  }

  resolveRun(token: string): RunContext | undefined {
    return this.#runsByToken.get(token)?.context;
  }

  notify(context: RunContext, input: NotifyInput): void {
    const run = this.#active(context);

    if (this.#isCancelled(run.context.profileId, run.context.sessionId)) {
      return;
    }

    const updated = this.#deps.db.markSessionUnreadAlert(run.context.sessionId);

    if (updated !== undefined) {
      this.#deps.events.emit({ kind: "session_updated", session: updated });
    }

    this.#deps.events.emit({
      kind: "notification",
      profileId: run.context.profileId,
      sessionId: run.context.sessionId,
      ...(input.title !== undefined ? { title: input.title } : {}),
      body: input.body,
    });
  }

  #isCancelled(profileId: ProfileId, sessionId: SessionId): boolean {
    return (
      this.#closing || this.#deletedSessions.has(sessionId) || this.#deletingProfiles.has(profileId)
    );
  }

  #revokeRun(run: ActiveRun): void {
    this.#runsByToken.delete(run.runToken);
    this.#runsById.delete(run.context.runId);
  }

  #active(context: RunContext): ActiveRun {
    const run = this.#runsById.get(context.runId);

    if (run === undefined) {
      throw new RpcError(409, `run ${context.runId} is no longer active`);
    }

    return run;
  }

  async #modelAuth(model: ModelRef): Promise<TurnModelAuth | undefined> {
    switch (model.auth) {
      case "api-key":
        return { kind: "run-token-key" };
      case "oauth":
        return this.#deps.llmOAuth.agentAuth(model.provider);
      default: {
        const exhaustive: never = model.auth;

        return exhaustive;
      }
    }
  }

  #setSessionStatus(
    sessionId: SessionId,
    status: "idle" | "running" | "error",
    errorMessage: string | null,
  ): void {
    if (this.#deletedSessions.has(sessionId)) {
      return;
    }

    const updated = this.#deps.db.updateSessionStatus(sessionId, { status, errorMessage });

    if (updated !== undefined) {
      this.#deps.events.emit({ kind: "session_updated", session: updated });
    }
  }

  async #run(profileId: ProfileId, sessionId: SessionId, trigger: TurnTrigger): Promise<void> {
    const { config, registry, events } = this.#deps;
    const profile = registry.get(profileId);

    if (profile === undefined) {
      this.#setSessionStatus(sessionId, "error", `Profile "${profileId}" is not loaded.`);

      return;
    }

    const runId = runIdSchema.parse(randomUUID());
    const runToken = randomBytes(32).toString("base64url");
    const controller = new AbortController();
    const run: ActiveRun = {
      context: { runId, profileId, sessionId },
      runToken,
      controller,
    };

    // Register before any await so abort/cancelSession sees the run during auth and mkdir.
    this.#activeBySession.set(sessionId, run);

    let started = false;
    let finishStatus: "idle" | "error" = "idle";
    let finishError: string | null = null;

    try {
      const { model } = profile.config;
      let modelAuth: TurnModelAuth | undefined;

      try {
        modelAuth = await this.#modelAuth(model);
      } catch (error) {
        console.error(`could not resolve model auth for profile ${profileId}`, error);
        this.#setSessionStatus(
          sessionId,
          "error",
          `Could not load the ${model.provider} login for this profile. Check the daemon logs.`,
        );

        return;
      }

      if (controller.signal.aborted || this.#isCancelled(profileId, sessionId)) {
        return;
      }

      if (modelAuth === undefined) {
        this.#setSessionStatus(
          sessionId,
          "error",
          `This profile signs in to ${model.provider} with OAuth, but the daemon has no login for it.`,
        );

        return;
      }

      const sessionFile = sessionTranscriptPath(config.sessionsDir, profileId, sessionId);

      await mkdir(dirname(sessionFile), { recursive: true });

      if (controller.signal.aborted || this.#isCancelled(profileId, sessionId)) {
        return;
      }

      this.#runsByToken.set(runToken, run);
      this.#runsById.set(runId, run);
      started = true;
      this.#setSessionStatus(sessionId, "running", null);
      events.emit({ kind: "turn_started", profileId, sessionId, runId, trigger });

      await runAgent(
        config.agent,
        {
          runId,
          runToken,
          profileId,
          sessionId,
          profileDir: profile.dir,
          sessionFile,
          socketPath: config.socketPath,
          model,
          modelAuth,
          trigger,
        },
        {
          signal: controller.signal,
          onEvent: (event) => {
            if (!this.#deletedSessions.has(sessionId)) {
              events.emit({ kind: "turn_event", profileId, sessionId, runId, event });
            }
          },
        },
      );
    } catch (error) {
      if (!this.#deletedSessions.has(sessionId)) {
        console.error(`run ${runId} for profile ${profileId} session ${sessionId} failed`, error);
      }

      finishStatus = "error";
      finishError = controller.signal.aborted
        ? "Run was aborted."
        : "This run failed before it finished. Check the daemon logs.";
    } finally {
      this.#revokeRun(run);

      if (this.#activeBySession.get(sessionId) === run) {
        this.#activeBySession.delete(sessionId);
      }

      if (started && !this.#deletedSessions.has(sessionId)) {
        this.#setSessionStatus(sessionId, finishStatus, finishError);
        events.emit({
          kind: "turn_finished",
          profileId,
          sessionId,
          runId,
          status: finishStatus,
          errorMessage: finishError,
        });
      }
    }

    if (!this.#closing && !this.#deletingProfiles.has(profileId)) {
      await this.#reloadAfterRun(profileId);
    }
  }

  async #reloadAfterRun(profileId: ProfileId): Promise<void> {
    if (this.#deletingProfiles.has(profileId)) {
      return;
    }

    const load = await this.#deps.registry.reload(profileId);

    if (this.#deletingProfiles.has(profileId)) {
      return;
    }

    const issues =
      load.kind === "loaded"
        ? [...load.issues, ...this.#deps.onProfileReloaded(load.profile)]
        : load.issues;

    for (const issue of issues) {
      console.warn(`profile ${profileId} config issue: ${issue.file}: ${issue.message}`);
    }
  }
}
