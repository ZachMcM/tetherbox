import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { InternalClient, ModuleContext } from "@tetherbox/core";
import { Type } from "typebox";
import { fetchWebPage } from "./web-fetch.ts";

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

function createNotificationTools(client: InternalClient): ToolDefinition[] {
  const notify = defineTool({
    name: "notify",
    label: "Notify user",
    description:
      "Send an alert for this session so the user is notified when something needs attention during a background run (cron, webhook, poll, or reminder). Do not call this for routine interactive replies.",
    parameters: Type.Object({
      title: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
      body: Type.String({ minLength: 1, maxLength: 1000 }),
    }),
    async execute(_toolCallId, params) {
      const response = await client.rpc.notify.$post({
        json: {
          body: params.body,
          ...(params.title !== undefined ? { title: params.title } : {}),
        },
      });

      if (!response.ok) {
        throw await failure(response, "notify");
      }

      return text("Notification recorded.");
    },
  });

  return [notify];
}

function createProfileTools(
  client: InternalClient,
  fetchWithSecret: ModuleContext["fetchWithSecret"],
): ToolDefinition[] {
  const checkSecret = defineTool({
    name: "check_secret",
    label: "Check secret",
    description:
      "Report whether a secret key (such as LINEAR_API_KEY or GOOGLE_CALENDAR_OAUTH) is stored and its binding kind, without revealing its value. Never ask for a secret value in chat.",
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
      "Use when you started work outside this turn that finishes later (a coding agent session, CI run, deploy, or review) and need to act on the result. The daemon runs `command` every intervalSeconds; when it reports done, or makes no progress for stallAfterSeconds, a new turn starts in this session with `prompt` and the command's output. Registering an existing name replaces it. For recurring schedules, write a cron file instead.",
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

function createWebTools(): ToolDefinition[] {
  const webFetch = defineTool({
    name: "web_fetch",
    label: "Fetch web page",
    description:
      "Fetch an http or https URL and return clean markdown for HTML pages or raw text for plain text, markdown, and JSON responses (capped at 32 KB). Prefer this over curl for reading docs and articles.",
    parameters: Type.Object({
      url: Type.String({ minLength: 1 }),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 60000 })),
    }),
    async execute(_toolCallId, params) {
      return json(
        await fetchWebPage({
          url: params.url,
          ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
        }),
      );
    },
  });

  return [webFetch];
}

function createReminderTools(client: InternalClient): ToolDefinition[] {
  const scheduleReminder = defineTool({
    name: "schedule_reminder",
    label: "Schedule reminder",
    description:
      "Schedule a one-shot reminder that wakes a new turn in this session at a future time (provide either fireAt as an ISO-8601 timestamp or delaySeconds). Registering an existing name replaces it. Use cron/ files for recurring schedules instead.",
    parameters: Type.Object({
      name: Type.String({ pattern: SLUG_PATTERN }),
      fireAt: Type.Optional(Type.String({ minLength: 1 })),
      delaySeconds: Type.Optional(Type.Integer({ minimum: 1 })),
      prompt: Type.String({ minLength: 1 }),
    }),
    async execute(_toolCallId, params) {
      let jsonBody:
        | { kind: "at"; name: string; fireAt: string; prompt: string }
        | { kind: "in"; name: string; delaySeconds: number; prompt: string };

      if (params.fireAt !== undefined && params.delaySeconds === undefined) {
        jsonBody = {
          kind: "at",
          name: params.name,
          fireAt: params.fireAt,
          prompt: params.prompt,
        };
      } else if (params.delaySeconds !== undefined && params.fireAt === undefined) {
        jsonBody = {
          kind: "in",
          name: params.name,
          delaySeconds: params.delaySeconds,
          prompt: params.prompt,
        };
      } else {
        throw new Error("Provide exactly one of fireAt or delaySeconds");
      }

      const response = await client.rpc.reminders.$post({ json: jsonBody });

      if (!response.ok) {
        throw await failure(response, "schedule_reminder");
      }

      return json(await response.json());
    },
  });
  const listReminders = defineTool({
    name: "list_reminders",
    label: "List reminders",
    description: "List this profile's pending one-shot reminders.",
    parameters: Type.Object({}),
    async execute() {
      const response = await client.rpc.reminders.$get();

      if (!response.ok) {
        throw await failure(response, "list_reminders");
      }

      return json((await response.json()).reminders);
    },
  });
  const cancelReminder = defineTool({
    name: "cancel_reminder",
    label: "Cancel reminder",
    description: "Cancel a pending one-shot reminder by name.",
    parameters: Type.Object({ name: Type.String({ pattern: SLUG_PATTERN }) }),
    async execute(_toolCallId, params) {
      const response = await client.rpc.reminders[":name"].$delete({
        param: { name: params.name },
      });

      if (!response.ok) {
        throw await failure(response, "cancel_reminder");
      }

      const { cancelled } = await response.json();

      return text(cancelled ? `Cancelled ${params.name}.` : `No reminder named ${params.name}.`);
    },
  });

  return [scheduleReminder, listReminders, cancelReminder];
}

export function createBuiltinTools(
  client: InternalClient,
  fetchWithSecret: ModuleContext["fetchWithSecret"],
): ToolDefinition[] {
  return [
    ...createNotificationTools(client),
    ...createWebTools(),
    ...createProfileTools(client, fetchWithSecret),
    ...createPollTools(client),
    ...createReminderTools(client),
  ];
}
