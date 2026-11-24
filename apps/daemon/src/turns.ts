import { randomBytes, randomUUID } from "node:crypto";
import {
  runIdSchema,
  type AddReactionInput,
  type ProfileId,
  type ProfileIssue,
  type RunContext,
  type RunId,
  type SendMessageInput,
  type TurnTrigger,
} from "@tetherbox/core";
import { runAgent } from "./agent-spawner.ts";
import type { DaemonConfig } from "./config.ts";
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
    const next = previous.then(() => this.#run(profileId, trigger, replyTarget));

    this.#queues.set(profileId, next);
  }

  resolveRun(token: string): RunContext | undefined {
    return this.#runsByToken.get(token)?.context;
  }

  async sendMessage(context: RunContext, input: SendMessageInput): Promise<{ ts: string }> {
    const run = this.#active(context);
    const result = await this.#deps.slack.postMessage(run.replyTarget, input.text);

    run.sentMessage = true;

    return result;
  }

  async addReaction(context: RunContext, input: AddReactionInput): Promise<void> {
    const run = this.#active(context);

    if (run.replyTarget.kind !== "thread") {
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

  async #run(profileId: ProfileId, trigger: TurnTrigger, replyTarget: ReplyTarget): Promise<void> {
    const { config, registry, slack } = this.#deps;
    const profile = registry.get(profileId);

    if (profile === undefined) {
      return;
    }

    const runId = runIdSchema.parse(randomUUID());
    const runToken = randomBytes(32).toString("base64url");
    const run: ActiveRun = { context: { runId, profileId }, replyTarget, sentMessage: false };

    this.#runsByToken.set(runToken, run);
    this.#runsById.set(runId, run);

    try {
      const result = await runAgent(config.agent, {
        runId,
        runToken,
        profileId,
        profileDir: profile.dir,
        socketPath: config.socketPath,
        model: profile.config.model,
        trigger,
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
