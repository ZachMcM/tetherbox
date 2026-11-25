import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { InternalClient, ModuleContext } from "@tetherbox/core";
import { Type } from "typebox";

const SLUG_PATTERN = "^[a-z0-9][a-z0-9-]{0,62}$";
const SECRET_KEY_PATTERN = "^[A-Z][A-Z0-9_]{0,127}$";
const MAX_PROXY_BODY_CHARS = 32 * 1024;

async function failure(response: Response, action: string): Promise<Error> {
  return new Error(`${action} failed with ${response.status}: ${await response.text()}`);
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }], details: {} };
}

function json(value: unknown) {
  return text(JSON.stringify(value, null, 2));
}

function createMessagingTools(client: InternalClient): ToolDefinition[] {
  const sendMessage = defineTool({
    name: "send_message",
    label: "Send message",
    description:
      "Post a message to the user in the conversation that started this turn. Use it for the final reply and for progress updates during long work.",
    parameters: Type.Object({ text: Type.String({ minLength: 1 }) }),
    async execute(_toolCallId, params) {
      const response = await client.rpc.messages.$post({ json: { text: params.text } });

      if (!response.ok) {
        throw await failure(response, "send_message");
      }

      return text("Sent.");
    },
  });
  const addReaction = defineTool({
    name: "add_reaction",
    label: "Add reaction",
    description:
      "React with an emoji (Slack name without colons) to the message that started this turn.",
    parameters: Type.Object({ emoji: Type.String({ minLength: 1 }) }),
    async execute(_toolCallId, params) {
      const response = await client.rpc.reactions.$post({ json: { emoji: params.emoji } });

      if (!response.ok) {
        throw await failure(response, "add_reaction");
      }

      return text("Reacted.");
    },
  });

  return [sendMessage, addReaction];
}

function createProfileTools(
  client: InternalClient,
  fetchWithSecret: ModuleContext["fetchWithSecret"],
): ToolDefinition[] {
  const checkSecret = defineTool({
    name: "check_secret",
    label: "Check secret",
    description:
      "Report whether a secret key (such as LINEAR_API_KEY) is stored and its binding kind, without revealing its value. If it is missing or has the wrong binding kind, tell the user to run `tetherbox secrets set <KEY> --domain <api host>` for an API key (adding `--inject header:<name>` or `--inject query:<name>` if not bearer auth) or `tetherbox secrets set <KEY>` for a webhook secret. Never ask for a secret value in chat.",
    parameters: Type.Object({ key: Type.String({ pattern: SECRET_KEY_PATTERN }) }),
    async execute(_toolCallId, params) {
      const response = await client.rpc.secrets[":key"].$get({ param: { key: params.key } });

      if (!response.ok) {
        throw await failure(response, "check_secret");
      }

      const result = await response.json();

      return text(
        result.exists ? `${params.key} is set (${result.kind}).` : `${params.key} is not set.`,
      );
    },
  });
  const proxyFetch = defineTool({
    name: "fetch_with_secret",
    label: "Fetch with secret",
    description:
      "Send an HTTPS request through the daemon's domain-pinned secret proxy, injecting the named proxy-bound secret without exposing its value. Use this to probe APIs while reverse-engineering or testing an integration before writing a module.",
    parameters: Type.Object({
      secretKey: Type.String({ pattern: SECRET_KEY_PATTERN }),
      url: Type.String({ minLength: 1 }),
      method: Type.Optional(
        Type.Union([
          Type.Literal("GET"),
          Type.Literal("POST"),
          Type.Literal("PUT"),
          Type.Literal("PATCH"),
          Type.Literal("DELETE"),
          Type.Literal("HEAD"),
        ]),
      ),
      headers: Type.Optional(Type.Record(Type.String(), Type.String())),
      body: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params) {
      const response = await fetchWithSecret(params.secretKey, params.url, {
        method: params.method ?? "GET",
        ...(params.headers !== undefined ? { headers: params.headers } : {}),
        ...(params.body !== undefined ? { body: params.body } : {}),
      });
      const rawBody = await response.text();
      const truncated = rawBody.length > MAX_PROXY_BODY_CHARS;
      const body = truncated ? rawBody.slice(0, MAX_PROXY_BODY_CHARS) : rawBody;

      return json({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
        ...(truncated ? { truncated: true } : {}),
      });
    },
  });
  const validateProfile = defineTool({
    name: "validate_profile",
    label: "Validate profile",
    description:
      "Check profile.json and the cron/ and webhooks/ files in this profile against the daemon's schemas. Run it after editing any of them; changes take effect when this turn ends.",
    parameters: Type.Object({}),
    async execute() {
      const response = await client.rpc.profile.validate.$post();

      if (!response.ok) {
        throw await failure(response, "validate_profile");
      }

      const result = await response.json();

      return result.ok ? text("Profile is valid.") : json(result.issues);
    },
  });

  return [checkSecret, proxyFetch, validateProfile];
}

function createPollTools(client: InternalClient): ToolDefinition[] {
  const registerPollJob = defineTool({
    name: "register_poll_job",
    label: "Register poll job",
    description:
      "Use when you started work outside this turn that finishes later (a coding agent session, CI run, deploy, or review) and need to act on the result. The daemon runs `command` every intervalSeconds; when it reports done, or makes no progress for stallAfterSeconds, a new turn starts with `prompt` and the command's output. Registering an existing name replaces it. For recurring schedules, write a cron file instead.",
    parameters: Type.Object({
      name: Type.String({ pattern: SLUG_PATTERN }),
      command: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
      intervalSeconds: Type.Integer({ minimum: 10 }),
      stallAfterSeconds: Type.Integer({ minimum: 1 }),
      prompt: Type.String({ minLength: 1 }),
    }),
    async execute(_toolCallId, params) {
      const [program, ...args] = params.command;

      if (program === undefined) {
        throw new Error("command needs at least a program name");
      }

      const response = await client.rpc["poll-jobs"].$post({
        json: {
          name: params.name,
          check: { command: [program, ...args] },
          intervalSeconds: params.intervalSeconds,
          stallAfterSeconds: params.stallAfterSeconds,
          prompt: params.prompt,
        },
      });

      if (!response.ok) {
        throw await failure(response, "register_poll_job");
      }

      return json(await response.json());
    },
  });
  const listPollJobs = defineTool({
    name: "list_poll_jobs",
    label: "List poll jobs",
    description: "List this profile's active poll jobs.",
    parameters: Type.Object({}),
    async execute() {
      const response = await client.rpc["poll-jobs"].$get();

      if (!response.ok) {
        throw await failure(response, "list_poll_jobs");
      }

      return json((await response.json()).jobs);
    },
  });
  const cancelPollJob = defineTool({
    name: "cancel_poll_job",
    label: "Cancel poll job",
    description: "Stop watching a poll job by name.",
    parameters: Type.Object({ name: Type.String({ pattern: SLUG_PATTERN }) }),
    async execute(_toolCallId, params) {
      const response = await client.rpc["poll-jobs"][":name"].$delete({
        param: { name: params.name },
      });

      if (!response.ok) {
        throw await failure(response, "cancel_poll_job");
      }

      const { cancelled } = await response.json();

      return text(cancelled ? `Cancelled ${params.name}.` : `No poll job named ${params.name}.`);
    },
  });

  return [registerPollJob, listPollJobs, cancelPollJob];
}

export function createBuiltinTools(
  client: InternalClient,
  fetchWithSecret: ModuleContext["fetchWithSecret"],
): ToolDefinition[] {
  return [
    ...createMessagingTools(client),
    ...createProfileTools(client, fetchWithSecret),
    ...createPollTools(client),
  ];
}
