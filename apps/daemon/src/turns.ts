import { randomBytes, randomUUID } from "node:crypto";
import { link, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  MAX_UPLOAD_FILE_BYTES,
  resolveProfileChannel,
  RpcError,
  runIdSchema,
  type AddReactionInput,
  type EntryName,
  type ModelRef,
  type ProfileId,
  type ProfileIssue,
  type RunContext,
  type RunId,
  type SendFileInput,
  type SendMessageInput,
  type TurnModelAuth,
  type TurnTrigger,
} from "@tetherbox/core";
import { runAgent } from "./agent-spawner.ts";
import type { DaemonConfig } from "./config.ts";
import type { LlmOAuth } from "./llm-oauth.ts";
import type { LoadedProfile, ProfileRegistry } from "./profiles.ts";
import type { ReplyTarget, SlackTransport } from "./slack.ts";

interface ActiveRun {
  context: RunContext;
  replyTarget: ReplyTarget;
  sentMessage: boolean;
  firstPostedTs: string | undefined;
  done: Promise<void>;
}

export interface TurnRunnerDeps {
  config: DaemonConfig;
  registry: ProfileRegistry;
  llmOAuth: LlmOAuth;
  slack: SlackTransport;
  onProfileReloaded(profile: LoadedProfile): ProfileIssue[];
}

function formatIssues(issues: readonly ProfileIssue[]): string {
  return [
    "Profile config has problems:",
    ...issues.map((issue) => `• ${issue.file}: ${issue.message}`),
  ].join("\n");
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function threadQueueKey(profileId: ProfileId, replyTarget: ReplyTarget): string | undefined {
  return replyTarget.kind === "channel"
    ? undefined
    : `${profileId}:${replyTarget.channelId}:${replyTarget.threadTs}`;
}

function sessionFilePath(
  sessionsDir: string,
  profileId: ProfileId,
  replyTarget: ReplyTarget,
  runId: RunId,
): string {
  const filename =
    replyTarget.kind === "channel" ? `.pending-${runId}.jsonl` : `${replyTarget.threadTs}.jsonl`;

  return join(sessionsDir, profileId, replyTarget.channelId, filename);
}

async function finalizePendingSession(
  sessionFile: string,
  postedTs: string | undefined,
): Promise<void> {
  if (postedTs !== undefined) {
    try {
      await link(sessionFile, join(dirname(sessionFile), `${postedTs}.jsonl`));
    } catch (error) {
      const code = errorCode(error);

      if (code !== "ENOENT" && code !== "EEXIST") {
        console.error(`failed to bind pending session ${sessionFile} to ${postedTs}`, error);
      }
    }
  }

  await rm(sessionFile, { force: true });
}

/**
 * Runs agent turns sequentially within each Slack thread while allowing separate threads and
 * threadless top-level triggers to run in parallel. A turn's reply goes out through
 * `send_message`; if the run never called it, the daemon posts the run's final text instead, so
 * each turn produces at most one fallback and never a duplicate.
 */
export class TurnRunner {
  readonly #deps: TurnRunnerDeps;
  readonly #runsByToken = new Map<string, ActiveRun>();
  readonly #runsById = new Map<RunId, ActiveRun>();
  readonly #queues = new Map<string, Promise<void>>();

  constructor(deps: TurnRunnerDeps) {
    this.#deps = deps;
  }

  enqueue(profileId: ProfileId, trigger: TurnTrigger, replyTarget: ReplyTarget): void {
    const queueKey = threadQueueKey(profileId, replyTarget);

    if (queueKey === undefined) {
      void this.#run(profileId, trigger, replyTarget).catch((error: unknown) => {
        console.error(`turn for profile ${profileId} failed`, error);
      });

      return;
    }

    const previous = this.#queues.get(queueKey) ?? Promise.resolve();
    const next = previous
      .then(() => this.#run(profileId, trigger, replyTarget))
      .catch((error: unknown) => {
        console.error(`turn for profile ${profileId} failed`, error);
      })
      .finally(() => {
        if (this.#queues.get(queueKey) === next) {
          this.#queues.delete(queueKey);
        }
      });

    this.#queues.set(queueKey, next);
  }

  resolveRun(token: string): RunContext | undefined {
    return this.#runsByToken.get(token)?.context;
  }

  replyOrigin(context: RunContext): { channelId: string; threadTs: string | undefined } {
    const run = this.#active(context);

    return {
      channelId: run.replyTarget.channelId,
      threadTs: run.replyTarget.kind === "channel" ? undefined : run.replyTarget.threadTs,
    };
  }

  async sendMessage(context: RunContext, input: SendMessageInput): Promise<{ ts: string }> {
    const run = this.#active(context);
    const target = this.#resolvePostTarget(run, input.channel);
    const result = await this.#deps.slack.postMessage(target, input.text);

    if (target.channelId === run.replyTarget.channelId) {
      if (run.replyTarget.kind === "channel" && run.firstPostedTs === undefined) {
        run.firstPostedTs = result.ts;
        this.#claimThreadQueue(run.context.profileId, target.channelId, result.ts, run.done);
      }

      run.sentMessage = true;
    }

    return result;
  }

  async sendFile(context: RunContext, input: SendFileInput): Promise<void> {
    const run = this.#active(context);
    const target = this.#resolvePostTarget(run, input.channel);
    const content = Buffer.from(input.contentBase64, "base64");

    if (content.byteLength === 0 || content.byteLength > MAX_UPLOAD_FILE_BYTES) {
      throw new RpcError(
        400,
        `File "${input.filename}" must be between 1 and ${MAX_UPLOAD_FILE_BYTES} bytes`,
      );
    }

    await this.#deps.slack.uploadFile(target, {
      filename: input.filename,
      content,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.initialComment !== undefined ? { initialComment: input.initialComment } : {}),
    });

    if (target.channelId === run.replyTarget.channelId) {
      run.sentMessage = true;
    }
  }

  async addReaction(context: RunContext, input: AddReactionInput): Promise<void> {
    const run = this.#active(context);

    if (run.replyTarget.kind !== "message") {
      throw new RpcError(
        400,
        "this run was not started by a Slack message, so there is nothing to react to",
      );
    }

    await this.#deps.slack.addReaction(
      run.replyTarget.channelId,
      run.replyTarget.sourceTs,
      input.emoji,
    );
  }

  #active(context: RunContext): ActiveRun {
    const run = this.#runsById.get(context.runId);

    if (run === undefined) {
      throw new RpcError(409, `run ${context.runId} is no longer active`);
    }

    return run;
  }

  #claimThreadQueue(
    profileId: ProfileId,
    channelId: string,
    threadTs: string,
    runDone: Promise<void>,
  ): void {
    const queueKey = `${profileId}:${channelId}:${threadTs}`;

    if (this.#queues.has(queueKey)) {
      return;
    }

    const cleanup = runDone.finally(() => {
      if (this.#queues.get(queueKey) === cleanup) {
        this.#queues.delete(queueKey);
      }
    });

    this.#queues.set(queueKey, cleanup);
  }

  #resolvePostTarget(run: ActiveRun, channel: EntryName | undefined): ReplyTarget {
    if (channel === undefined) {
      return run.replyTarget;
    }

    const profile = this.#deps.registry.get(run.context.profileId);

    if (profile === undefined) {
      throw new RpcError(404, `profile ${run.context.profileId} is not loaded`);
    }

    const channelId = resolveProfileChannel(profile.config, channel);

    if (channelId === undefined) {
      throw new RpcError(400, `unknown channel "${channel}" for profile ${profile.id}`);
    }

    return { kind: "channel", channelId };
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

  async #run(profileId: ProfileId, trigger: TurnTrigger, replyTarget: ReplyTarget): Promise<void> {
    const { config, registry, slack } = this.#deps;
    const profile = registry.get(profileId);

    if (profile === undefined) {
      return;
    }

    const { model } = profile.config;
    let modelAuth: TurnModelAuth | undefined;

    try {
      modelAuth = await this.#modelAuth(model);
    } catch (error) {
      console.error(`could not resolve model auth for profile ${profileId}`, error);
      await slack.postMessage(
        replyTarget,
        `Could not load the ${model.provider} login for this profile. Check the daemon logs.`,
      );

      return;
    }

    if (modelAuth === undefined) {
      await slack.postMessage(
        replyTarget,
        `This profile signs in to ${model.provider} with OAuth, but the daemon has no login for it. Run: tetherbox llm login ${model.provider}`,
      );

      return;
    }

    const runId = runIdSchema.parse(randomUUID());
    const runToken = randomBytes(32).toString("base64url");
    const sessionFile = sessionFilePath(config.sessionsDir, profileId, replyTarget, runId);
    const { promise: done, resolve: resolveDone } = Promise.withResolvers<void>();
    const run: ActiveRun = {
      context: { runId, profileId },
      replyTarget,
      sentMessage: false,
      firstPostedTs: undefined,
      done,
    };

    this.#runsByToken.set(runToken, run);
    this.#runsById.set(runId, run);

    try {
      const threadTs = replyTarget.kind === "channel" ? undefined : replyTarget.threadTs;
      const result = await runAgent(config.agent, {
        runId,
        runToken,
        profileId,
        profileDir: profile.dir,
        sessionFile,
        socketPath: config.socketPath,
        model,
        modelAuth,
        trigger,
        channelId: replyTarget.channelId,
        ...(threadTs !== undefined ? { threadTs } : {}),
      });

      if (!run.sentMessage && result.finalText !== null && result.finalText.trim() !== "") {
        const posted = await slack.postMessage(replyTarget, result.finalText);

        if (replyTarget.kind === "channel" && run.firstPostedTs === undefined) {
          run.firstPostedTs = posted.ts;
          this.#claimThreadQueue(profileId, replyTarget.channelId, posted.ts, done);
        }
      }
    } catch (error) {
      console.error(`run ${runId} for profile ${profileId} failed`, error);
      await slack.postMessage(
        replyTarget,
        "This run failed before it finished. Check the daemon logs.",
      );
    } finally {
      this.#runsByToken.delete(runToken);
      this.#runsById.delete(runId);

      if (replyTarget.kind === "channel") {
        await finalizePendingSession(sessionFile, run.firstPostedTs);
      }

      resolveDone();
    }

    await this.#reloadAfterRun(profileId, replyTarget);
  }

  async #reloadAfterRun(profileId: ProfileId, replyTarget: ReplyTarget): Promise<void> {
    const load = await this.#deps.registry.reload(profileId);
    const issues =
      load.kind === "loaded"
        ? [...load.issues, ...this.#deps.onProfileReloaded(load.profile)]
        : load.issues;

    if (issues.length > 0) {
      await this.#deps.slack.postMessage(replyTarget, formatIssues(issues));
    }
  }
}
