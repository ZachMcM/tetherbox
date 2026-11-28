import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  RpcError,
  runIdSchema,
  sessionIdSchema,
  type ModelSelection,
  type NotifyInput,
  type ProfileId,
  type ProfileIssue,
  type RunContext,
  type RunId,
  type SessionId,
  type TurnModelAuth,
  type TurnStreamEvent,
  type TurnTrigger,
} from "@tetherbox/core";
import { runAgent } from "./agent-spawner.ts";
import type { DaemonConfig } from "../config.ts";
import type { SessionTable } from "../db/sessions.ts";
import type { AppSettingsTable } from "../db/settings.ts";
import type { DaemonEvent, DaemonEventBus } from "../events.ts";
import type { LlmOAuth } from "../credentials/llm-oauth.ts";
import type { LoadedProfile, ProfileRegistry } from "../profiles/registry.ts";
import { readSessionTranscript, sessionTranscriptPath } from "./transcript.ts";

const MAX_SESSION_TITLE_CHARS = 80;

export const DEFAULT_SESSION_TITLE = "New session";

export function sessionTitleFromText(text: string): string {
  const compact = text.trim().replace(/\s+/g, " ");

  if (compact.length <= MAX_SESSION_TITLE_CHARS) {
    return compact;
  }

  return `${compact.slice(0, MAX_SESSION_TITLE_CHARS - 1).trimEnd()}…`;
}

type LiveRunEvent = Extract<DaemonEvent, { kind: "turn_started" | "turn_event" }>;
type TurnEventMessage = Extract<DaemonEvent, { kind: "turn_event" }>;

function mergeDeltas(
  previous: TurnStreamEvent,
  next: TurnStreamEvent,
): TurnStreamEvent | undefined {
  if (previous.kind === "text_delta" && next.kind === "text_delta") {
    return { kind: "text_delta", delta: previous.delta + next.delta };
  }

  if (previous.kind === "thinking_delta" && next.kind === "thinking_delta") {
    return { kind: "thinking_delta", delta: previous.delta + next.delta };
  }

  return undefined;
}

interface ActiveRun {
  context: RunContext;
  runToken: string;
  controller: AbortController;
  model: ModelSelection;
}

export interface TurnRunnerDeps {
  config: DaemonConfig;
  registry: ProfileRegistry;
  llmOAuth: LlmOAuth;
  sessions: SessionTable;
  settings: AppSettingsTable;
  events: DaemonEventBus;
  onProfileReloaded(profile: LoadedProfile): Promise<ProfileIssue[]>;
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
  readonly #liveEvents = new Map<RunId, LiveRunEvent[]>();
  #closing = false;

  constructor(deps: TurnRunnerDeps) {
    this.#deps = deps;
  }

  liveRunEvents(): LiveRunEvent[] {
    return [...this.#liveEvents.values()]
      .flat()
      .filter((event) => !this.#deletedSessions.has(event.sessionId));
  }

  enqueue(
    profileId: ProfileId,
    trigger: TurnTrigger,
    options: { sessionId?: SessionId | undefined; model?: ModelSelection | undefined } = {},
  ): SessionId {
    const { sessionId: existingSessionId, model } = options;

    if (this.#closing || this.#deletingProfiles.has(profileId)) {
      throw new RpcError(409, `profile "${profileId}" is not accepting turns`);
    }

    if (existingSessionId !== undefined && this.#deletedSessions.has(existingSessionId)) {
      throw new RpcError(404, `session "${existingSessionId}" was deleted`);
    }

    const sessionId = existingSessionId ?? sessionIdSchema.parse(randomUUID());
    const existing = this.#deps.sessions.get(sessionId);

    if (existing !== undefined && existing.profileId !== profileId) {
      throw new RpcError(
        409,
        `session "${sessionId}" belongs to profile "${existing.profileId}", not "${profileId}"`,
      );
    }

    if (existing === undefined) {
      const created = this.#deps.sessions.create({
        id: sessionId,
        profileId,
        title: deriveSessionTitle(trigger),
        triggerKind: trigger.kind,
        model: model ?? null,
      });

      this.#deps.events.emit({ kind: "session_updated", session: created });
    } else if (model !== undefined) {
      const updated = this.#deps.sessions.updateModel(sessionId, model);

      if (updated !== undefined) {
        this.#deps.events.emit({ kind: "session_updated", session: updated });
      }
    }

    const previous = this.#queues.get(sessionId) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        if (this.#isCancelled(profileId, sessionId)) {
          return;
        }

        await this.#run(profileId, sessionId, trigger, model);
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

  resolveRunModel(runId: RunId): ModelSelection | undefined {
    return this.#runsById.get(runId)?.model;
  }

  notify(context: RunContext, input: NotifyInput): void {
    const run = this.#active(context);

    if (this.#isCancelled(run.context.profileId, run.context.sessionId)) {
      return;
    }

    const updated = this.#deps.sessions.markUnreadAlert(run.context.sessionId);

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

  async #modelAuth(model: ModelSelection): Promise<TurnModelAuth | undefined> {
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

    const updated = this.#deps.sessions.updateStatus(sessionId, { status, errorMessage });

    if (updated !== undefined) {
      this.#deps.events.emit({ kind: "session_updated", session: updated });
    }
  }

  #resolveModel(
    sessionId: SessionId,
    profileModel: ModelSelection | undefined,
  ): ModelSelection | undefined {
    return (
      this.#deps.sessions.get(sessionId)?.model ??
      profileModel ??
      this.#deps.settings.get().defaultModel ??
      undefined
    );
  }

  async #run(
    profileId: ProfileId,
    sessionId: SessionId,
    trigger: TurnTrigger,
    requestedModel: ModelSelection | undefined,
  ): Promise<void> {
    const { config, registry, events } = this.#deps;
    const profile = registry.get(profileId);

    if (profile === undefined) {
      this.#setSessionStatus(sessionId, "error", `Profile "${profileId}" is not loaded.`);

      return;
    }

    let model: ModelSelection | undefined;

    try {
      model = requestedModel ?? this.#resolveModel(sessionId, profile.config.model);
    } catch (error) {
      console.error(`could not resolve the model for session ${sessionId}`, error);
      this.#setSessionStatus(
        sessionId,
        "error",
        "Could not read this session's model settings. Check the daemon logs.",
      );

      return;
    }

    if (model === undefined) {
      this.#setSessionStatus(
        sessionId,
        "error",
        "No model selected and no default model configured. Configure a provider and default model in Settings.",
      );

      return;
    }

    const runId = runIdSchema.parse(randomUUID());
    const runToken = randomBytes(32).toString("base64url");
    const controller = new AbortController();
    const run: ActiveRun = {
      context: { runId, profileId, sessionId },
      runToken,
      controller,
      model,
    };

    // Register before any await so abort/cancelSession sees the run during auth and mkdir.
    this.#activeBySession.set(sessionId, run);

    let started = false;
    let finishStatus: "idle" | "error" = "idle";
    let finishError: string | null = null;

    try {
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

      const baselineEntryCount = (
        await readSessionTranscript(config.sessionsDir, profileId, sessionId)
      ).length;

      if (controller.signal.aborted || this.#isCancelled(profileId, sessionId)) {
        return;
      }

      this.#runsByToken.set(runToken, run);
      this.#runsById.set(runId, run);
      started = true;
      this.#setSessionStatus(sessionId, "running", null);
      const turnStarted: LiveRunEvent = {
        kind: "turn_started",
        profileId,
        sessionId,
        runId,
        trigger,
        baselineEntryCount,
      };

      this.#liveEvents.set(runId, [turnStarted]);
      events.emit(turnStarted);

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
              this.#emitTurnEvent({ kind: "turn_event", profileId, sessionId, runId, event });
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
      this.#liveEvents.delete(runId);
      this.#revokeRun(run);

      if (this.#activeBySession.get(sessionId) === run) {
        this.#activeBySession.delete(sessionId);
      }

      if (started || finishStatus === "error") {
        this.#setSessionStatus(sessionId, finishStatus, finishError);
      }

      if (started && !this.#deletedSessions.has(sessionId)) {
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

  #emitTurnEvent(event: TurnEventMessage): void {
    const buffered = this.#liveEvents.get(event.runId);

    if (buffered === undefined) {
      return;
    }

    const last = buffered.at(-1);
    const merged = last?.kind === "turn_event" ? mergeDeltas(last.event, event.event) : undefined;

    if (last?.kind === "turn_event" && merged !== undefined) {
      buffered[buffered.length - 1] = { ...last, event: merged };
    } else {
      const update = event.event;

      if (update.kind === "tool_update") {
        const superseded = buffered.findIndex(
          (entry) =>
            entry.kind === "turn_event" &&
            entry.event.kind === "tool_update" &&
            entry.event.toolCallId === update.toolCallId,
        );

        if (superseded !== -1) {
          buffered.splice(superseded, 1);
        }
      }

      buffered.push(event);
    }

    this.#deps.events.emit(event);
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
        ? [...load.issues, ...(await this.#deps.onProfileReloaded(load.profile))]
        : load.issues;

    for (const issue of issues) {
      console.warn(`profile ${profileId} config issue: ${issue.file}: ${issue.message}`);
    }
  }
}
