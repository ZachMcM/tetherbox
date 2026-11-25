import { randomBytes, randomUUID } from "node:crypto";
import {
  MAX_UPLOAD_FILE_BYTES,
  runIdSchema,
  type AddReactionInput,
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

/**
 * Runs agent turns one at a time per profile. A turn's reply goes out through `send_message`; if
 * the run never called it, the daemon posts the run's final text instead, so each turn produces
 * at most one fallback and never a duplicate.
 */
export class TurnRunner {
  readonly #deps: TurnRunnerDeps;
  readonly #runsByToken = new Map<string, ActiveRun>();
  readonly #runsById = new Map<RunId, ActiveRun>();
  readonly #queues = new Map<ProfileId, Promise<void>>();

  constructor(deps: TurnRunnerDeps) {
    this.#deps = deps;
  }

  enqueue(profileId: ProfileId, trigger: TurnTrigger, replyTarget: ReplyTarget): void {
    const previous = this.#queues.get(profileId) ?? Promise.resolve();
    const next = previous
      .then(() => this.#run(profileId, trigger, replyTarget))
      .catch((error: unknown) => {
        console.error(`turn for profile ${profileId} failed`, error);
      });

    this.#queues.set(profileId, next);
  }

  resolveRun(token: string): RunContext | undefined {
    return this.#runsByToken.get(token)?.context;
  }

  replyThreadTs(context: RunContext): string | undefined {
    const run = this.#active(context);

    return run.replyTarget.kind === "channel" ? undefined : run.replyTarget.threadTs;
  }

  async sendMessage(context: RunContext, input: SendMessageInput): Promise<{ ts: string }> {
    const run = this.#active(context);
    const result = await this.#deps.slack.postMessage(run.replyTarget, input.text);

    run.sentMessage = true;

    return result;
  }

  async sendFile(context: RunContext, input: SendFileInput): Promise<void> {
    const run = this.#active(context);
    const content = Buffer.from(input.contentBase64, "base64");

    if (content.byteLength === 0 || content.byteLength > MAX_UPLOAD_FILE_BYTES) {
      throw new Error(
        `File "${input.filename}" must be between 1 and ${MAX_UPLOAD_FILE_BYTES} bytes`,
      );
    }

    await this.#deps.slack.uploadFile(run.replyTarget, {
      filename: input.filename,
      content,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.initialComment !== undefined ? { initialComment: input.initialComment } : {}),
    });
    run.sentMessage = true;
  }

  async addReaction(context: RunContext, input: AddReactionInput): Promise<void> {
    const run = this.#active(context);

    if (run.replyTarget.kind !== "message") {
      throw new Error(
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
      throw new Error(`run ${context.runId} is no longer active`);
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
    const run: ActiveRun = { context: { runId, profileId }, replyTarget, sentMessage: false };

    this.#runsByToken.set(runToken, run);
    this.#runsById.set(runId, run);

    try {
      const threadTs = replyTarget.kind === "channel" ? undefined : replyTarget.threadTs;
      const result = await runAgent(config.agent, {
        runId,
        runToken,
        profileId,
        profileDir: profile.dir,
        socketPath: config.socketPath,
        model,
        modelAuth,
        trigger,
        ...(threadTs !== undefined ? { threadTs } : {}),
      });

      if (!run.sentMessage && result.finalText !== null && result.finalText.trim() !== "") {
        await slack.postMessage(replyTarget, result.finalText);
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
