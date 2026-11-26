import { randomUUID } from "node:crypto";
import type { AuthEvent, AuthPrompt, ProviderAuthInteraction } from "@earendil-works/pi-ai";
import {
  getLlmOAuthProvider,
  RpcError,
  type LlmOAuthFlowEvent,
  type LlmOAuthFlowPrompt,
  type LlmOAuthFlowState,
  type LlmProvider,
} from "@tetherbox/core";
import type { LlmOAuth } from "./llm-oauth.ts";

const FLOW_ACTIVE_TIMEOUT_MS = 5 * 60_000;
const FLOW_TTL_MS = 10 * 60_000;
const INITIAL_WAIT_MS = 150;

interface ActiveFlow {
  state: LlmOAuthFlowState;
  controller: AbortController;
  timeout: ReturnType<typeof setTimeout>;
  resolvePendingPrompt?: ((value: string) => void) | undefined;
  settledAt?: number | undefined;
  onActivity?: (() => void) | undefined;
}

function mapAuthEvent(event: AuthEvent): LlmOAuthFlowEvent {
  switch (event.type) {
    case "auth_url":
      return {
        kind: "auth_url",
        url: event.url,
        ...(event.instructions !== undefined ? { instructions: event.instructions } : {}),
      };
    case "device_code":
      return {
        kind: "device_code",
        verificationUri: event.verificationUri,
        userCode: event.userCode,
      };
    case "info":
      return {
        kind: "info",
        message: event.message,
        ...(event.links !== undefined
          ? {
              links: event.links.map((link) => ({
                url: link.url,
                ...(link.label !== undefined ? { label: link.label } : {}),
              })),
            }
          : {}),
      };
    case "progress":
      return { kind: "progress", message: event.message };
    default: {
      const exhaustive: never = event;

      return exhaustive;
    }
  }
}

function mapAuthPrompt(prompt: AuthPrompt): LlmOAuthFlowPrompt {
  if (prompt.type === "select") {
    return {
      kind: "select",
      message: prompt.message,
      options: prompt.options.map((option) => ({
        id: option.id,
        label: option.label,
        ...(option.description !== undefined ? { description: option.description } : {}),
      })),
    };
  }

  return {
    kind: "text",
    message: prompt.message,
    ...(prompt.placeholder !== undefined ? { placeholder: prompt.placeholder } : {}),
  };
}

function cloneState(state: LlmOAuthFlowState): LlmOAuthFlowState {
  return { ...state, events: [...state.events] };
}

/**
 * Drives Pi's interactive LLM OAuth flows over HTTP for the web UI instead of a TTY.
 */
export class LlmWebAuthManager {
  readonly #llmOAuth: LlmOAuth;
  readonly #flows = new Map<string, ActiveFlow>();

  constructor(llmOAuth: LlmOAuth) {
    this.#llmOAuth = llmOAuth;
  }

  async start(provider: LlmProvider): Promise<LlmOAuthFlowState> {
    this.#prune();

    if (getLlmOAuthProvider(provider) === undefined) {
      throw new RpcError(400, `provider "${provider}" does not support OAuth login`);
    }

    const id = randomUUID();
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new Error("OAuth login timed out"));
    }, FLOW_ACTIVE_TIMEOUT_MS);
    const flow: ActiveFlow = {
      state: {
        id,
        provider,
        status: "pending",
        events: [],
        prompt: null,
        error: null,
      },
      controller,
      timeout,
    };

    this.#flows.set(id, flow);

    const notifyActivity = () => {
      flow.onActivity?.();
      flow.onActivity = undefined;
    };

    const interaction: ProviderAuthInteraction = {
      signal: controller.signal,
      notify: (event) => {
        flow.state.events.push(mapAuthEvent(event));
        notifyActivity();
      },
      prompt: (prompt) => {
        const signal = AbortSignal.any([
          controller.signal,
          ...(prompt.signal ? [prompt.signal] : []),
        ]);

        return new Promise<string>((resolve, reject) => {
          if (signal.aborted) {
            reject(new Error("Login cancelled"));

            return;
          }

          const onAbort = () => {
            flow.resolvePendingPrompt = undefined;
            reject(new Error("Login cancelled"));
          };

          signal.addEventListener("abort", onAbort, { once: true });
          flow.state = {
            id: flow.state.id,
            provider: flow.state.provider,
            events: flow.state.events,
            status: "waiting_input",
            prompt: mapAuthPrompt(prompt),
            error: null,
          };
          flow.resolvePendingPrompt = (value) => {
            signal.removeEventListener("abort", onAbort);
            resolve(value);
          };

          notifyActivity();
        });
      },
    };

    void this.#llmOAuth
      .login(provider, interaction)
      .then(() => {
        clearTimeout(flow.timeout);
        flow.resolvePendingPrompt = undefined;
        flow.state = {
          id: flow.state.id,
          provider: flow.state.provider,
          events: flow.state.events,
          status: "completed",
          prompt: null,
          error: null,
        };
        flow.settledAt = Date.now();
        notifyActivity();
      })
      .catch((error: unknown) => {
        clearTimeout(flow.timeout);
        flow.resolvePendingPrompt = undefined;
        flow.settledAt = Date.now();

        if (controller.signal.aborted) {
          const reason = controller.signal.reason;
          const message = reason instanceof Error ? reason.message : "Login cancelled";
          const timedOut = message === "OAuth login timed out";

          flow.state = {
            id: flow.state.id,
            provider: flow.state.provider,
            events: flow.state.events,
            status: timedOut ? "failed" : "cancelled",
            prompt: null,
            error: message,
          };
        } else {
          flow.state = {
            id: flow.state.id,
            provider: flow.state.provider,
            events: flow.state.events,
            status: "failed",
            prompt: null,
            error: error instanceof Error ? error.message : String(error),
          };
        }

        notifyActivity();
      });

    await new Promise<void>((resolve) => {
      if (flow.state.events.length > 0 || flow.state.status !== "pending") {
        resolve();

        return;
      }

      const timer = setTimeout(() => {
        flow.onActivity = undefined;
        resolve();
      }, INITIAL_WAIT_MS);

      flow.onActivity = () => {
        clearTimeout(timer);
        resolve();
      };
    });

    return cloneState(flow.state);
  }

  get(flowId: string): LlmOAuthFlowState {
    this.#prune();

    const flow = this.#flows.get(flowId);

    if (flow === undefined) {
      throw new RpcError(404, `unknown OAuth flow "${flowId}"`);
    }

    return cloneState(flow.state);
  }

  respond(flowId: string, value: string): LlmOAuthFlowState {
    const flow = this.#flows.get(flowId);

    if (flow === undefined) {
      throw new RpcError(404, `unknown OAuth flow "${flowId}"`);
    }

    const resolvePending = flow.resolvePendingPrompt;

    if (resolvePending === undefined) {
      throw new RpcError(409, `OAuth flow "${flowId}" is not waiting for input`);
    }

    flow.resolvePendingPrompt = undefined;
    flow.state = {
      id: flow.state.id,
      provider: flow.state.provider,
      events: flow.state.events,
      status: "pending",
      prompt: null,
      error: null,
    };
    resolvePending(value);

    return cloneState(flow.state);
  }

  cancel(flowId: string): { cancelled: boolean } {
    const flow = this.#flows.get(flowId);

    if (flow === undefined) {
      return { cancelled: false };
    }

    clearTimeout(flow.timeout);
    flow.controller.abort(new Error("Login cancelled"));

    return { cancelled: true };
  }

  stopAll(): void {
    for (const flow of this.#flows.values()) {
      clearTimeout(flow.timeout);
      flow.controller.abort(new Error("Daemon shutting down"));
    }

    this.#flows.clear();
  }

  #prune(): void {
    const cutoff = Date.now() - FLOW_TTL_MS;

    for (const [id, flow] of this.#flows) {
      if (flow.settledAt !== undefined && flow.settledAt < cutoff) {
        this.#flows.delete(id);
      }
    }
  }
}
