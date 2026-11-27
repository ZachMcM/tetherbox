import type { ModuleContext, ModuleToolResult, TetherboxModule } from "@tetherbox/core";

const SECRET_KEY = "GOOGLE_CALENDAR_OAUTH";
const BASE_URL = "https://www.googleapis.com/calendar/v3";
const MAX_RESULT_CHARS = 32 * 1024;
const MAX_ERROR_CHARS = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(params: unknown): Record<string, unknown> {
  return isRecord(params) ? params : {};
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Expected non-empty string for "${key}"`);
  }

  return value.trim();
}

function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Expected string for "${key}"`);
  }

  const trimmed = value.trim();

  return trimmed === "" ? undefined : trimmed;
}

function optionalNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected finite number for "${key}"`);
  }

  return value;
}

function optionalBoolean(obj: Record<string, unknown>, key: string): boolean | undefined {
  const value = obj[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`Expected boolean for "${key}"`);
  }

  return value;
}

function optionalStringArray(obj: Record<string, unknown>, key: string): string[] | undefined {
  const value = obj[key];

  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Expected string array for "${key}"`);
  }

  return value;
}

function cappedJsonResult(value: unknown): ModuleToolResult {
  const safeValue = value === undefined ? null : value;
  const serialized = JSON.stringify(safeValue, null, 2);

  if (serialized.length <= MAX_RESULT_CHARS) {
    return { kind: "json", value: safeValue };
  }

  return {
    kind: "json",
    value: {
      truncated: true,
      body: serialized.slice(0, MAX_RESULT_CHARS),
    },
  };
}

function toEventTime(value: string, allDay: boolean, timeZone?: string): Record<string, string> {
  if (allDay || /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { date: value };
  }

  return timeZone !== undefined ? { dateTime: value, timeZone } : { dateTime: value };
}

async function calendarRequest(
  ctx: ModuleContext,
  path: string,
  options: {
    method?: string;
    query?: Record<string, string | undefined>;
    body?: unknown;
  } = {},
): Promise<ModuleToolResult> {
  if (!(await ctx.hasSecret(SECRET_KEY))) {
    return {
      kind: "text",
      text: `Missing ${SECRET_KEY}. Connect Google Calendar in Tetherbox Settings -> Integrations.`,
    };
  }

  const url = new URL(`${BASE_URL}${path}`);

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  const response = await ctx.fetchWithSecret(SECRET_KEY, url, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  if (response.status === 204) {
    return { kind: "json", value: { ok: true } };
  }

  const raw = await response.text();

  if (!response.ok) {
    if (
      response.status === 403 &&
      (raw.includes("insufficientPermissions") || raw.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT"))
    ) {
      throw new Error(
        "Google Calendar returned 403 (insufficient OAuth scope). Reconnect Google Calendar with read and write permissions in Tetherbox Settings -> Integrations.",
      );
    }

    throw new Error(
      `Google Calendar API returned ${response.status}: ${raw.slice(0, MAX_ERROR_CHARS)}`,
    );
  }

  if (raw.trim() === "") {
    return { kind: "json", value: { ok: true } };
  }

  return cappedJsonResult(JSON.parse(raw));
}

export default {
  name: "gcal",
  description: "Read and manage Google Calendar events and availability.",
  requiredSecrets: [SECRET_KEY],
  tools: [
    {
      name: "list_calendars",
      description: "List the user's Google Calendars.",
      parameters: {
        type: "object",
        properties: {
          maxResults: { type: "number", description: "Maximum calendars to return (default 50)." },
          pageToken: { type: "string", description: "Pagination token from nextPageToken." },
        },
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const maxResults = optionalNumber(obj, "maxResults");

        return calendarRequest(ctx, "/users/me/calendarList", {
          query: {
            maxResults: maxResults !== undefined ? String(Math.trunc(maxResults)) : "50",
            pageToken: optionalString(obj, "pageToken"),
          },
        });
      },
    },
    {
      name: "list_events",
      description: "List or search events on a Google Calendar within an optional time range.",
      parameters: {
        type: "object",
        properties: {
          calendarId: { type: "string", description: 'Calendar ID (defaults to "primary").' },
          timeMin: { type: "string", description: "RFC3339 lower bound for event end time." },
          timeMax: { type: "string", description: "RFC3339 upper bound for event start time." },
          query: { type: "string", description: "Free-text search query." },
          maxResults: {
            type: "number",
            description: "Max events to return (default 25, max 250).",
          },
          singleEvents: {
            type: "boolean",
            description: "Expand recurring events into instances (default true).",
          },
          pageToken: { type: "string", description: "Pagination token from nextPageToken." },
        },
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const calendarId = optionalString(obj, "calendarId") ?? "primary";
        const singleEvents = optionalBoolean(obj, "singleEvents") ?? true;
        const maxResults = Math.min(
          250,
          Math.max(1, Math.trunc(optionalNumber(obj, "maxResults") ?? 25)),
        );

        return calendarRequest(ctx, `/calendars/${encodeURIComponent(calendarId)}/events`, {
          query: {
            timeMin: optionalString(obj, "timeMin"),
            timeMax: optionalString(obj, "timeMax"),
            q: optionalString(obj, "query"),
            maxResults: String(maxResults),
            singleEvents: String(singleEvents),
            orderBy: singleEvents ? "startTime" : undefined,
            pageToken: optionalString(obj, "pageToken"),
          },
        });
      },
    },
    {
      name: "get_event",
      description: "Fetch a single Google Calendar event by ID.",
      parameters: {
        type: "object",
        properties: {
          eventId: { type: "string", description: "Event ID." },
          calendarId: { type: "string", description: 'Calendar ID (defaults to "primary").' },
        },
        required: ["eventId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const calendarId = optionalString(obj, "calendarId") ?? "primary";
        const eventId = requireString(obj, "eventId");

        return calendarRequest(
          ctx,
          `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        );
      },
    },
    {
      name: "create_event",
      description: "Create a new Google Calendar event.",
      parameters: {
        type: "object",
        properties: {
          calendarId: { type: "string", description: 'Calendar ID (defaults to "primary").' },
          summary: { type: "string", description: "Event title." },
          start: {
            type: "string",
            description: "Start time as RFC3339 timestamp or YYYY-MM-DD for an all-day event.",
          },
          end: {
            type: "string",
            description:
              "End time as RFC3339 timestamp or YYYY-MM-DD (exclusive) for an all-day event.",
          },
          allDay: { type: "boolean", description: "Set true for YYYY-MM-DD all-day events." },
          timeZone: {
            type: "string",
            description: "Optional IANA time zone (e.g. America/Los_Angeles).",
          },
          description: { type: "string", description: "Event description." },
          location: { type: "string", description: "Event location." },
          attendees: {
            type: "array",
            items: { type: "string" },
            description: "Attendee email addresses.",
          },
          sendUpdates: {
            type: "string",
            description: 'Who receives notifications: "all", "externalOnly", or "none".',
          },
        },
        required: ["summary", "start", "end"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const calendarId = optionalString(obj, "calendarId") ?? "primary";
        const allDay = optionalBoolean(obj, "allDay") ?? false;
        const timeZone = optionalString(obj, "timeZone");
        const attendees = optionalStringArray(obj, "attendees");
        const body: Record<string, unknown> = {
          summary: requireString(obj, "summary"),
          start: toEventTime(requireString(obj, "start"), allDay, timeZone),
          end: toEventTime(requireString(obj, "end"), allDay, timeZone),
        };
        const description = optionalString(obj, "description");
        const location = optionalString(obj, "location");

        if (description !== undefined) {
          body.description = description;
        }

        if (location !== undefined) {
          body.location = location;
        }

        if (attendees !== undefined) {
          body.attendees = attendees.map((email) => ({ email }));
        }

        return calendarRequest(ctx, `/calendars/${encodeURIComponent(calendarId)}/events`, {
          method: "POST",
          query: { sendUpdates: optionalString(obj, "sendUpdates") },
          body,
        });
      },
    },
    {
      name: "update_event",
      description: "Patch fields on an existing Google Calendar event.",
      parameters: {
        type: "object",
        properties: {
          calendarId: { type: "string", description: 'Calendar ID (defaults to "primary").' },
          eventId: { type: "string", description: "Event ID." },
          summary: { type: "string", description: "New title." },
          start: { type: "string", description: "New start RFC3339 timestamp or YYYY-MM-DD." },
          end: { type: "string", description: "New end RFC3339 timestamp or YYYY-MM-DD." },
          allDay: { type: "boolean", description: "Set true when start/end are YYYY-MM-DD dates." },
          timeZone: { type: "string", description: "Optional IANA time zone." },
          description: { type: "string", description: "New description." },
          location: { type: "string", description: "New location." },
          attendees: {
            type: "array",
            items: { type: "string" },
            description: "Replacement attendee email addresses.",
          },
          sendUpdates: {
            type: "string",
            description: 'Who receives notifications: "all", "externalOnly", or "none".',
          },
        },
        required: ["eventId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const calendarId = optionalString(obj, "calendarId") ?? "primary";
        const eventId = requireString(obj, "eventId");
        const allDay = optionalBoolean(obj, "allDay") ?? false;
        const timeZone = optionalString(obj, "timeZone");
        const body: Record<string, unknown> = {};
        const summary = optionalString(obj, "summary");
        const start = optionalString(obj, "start");
        const end = optionalString(obj, "end");
        const description = optionalString(obj, "description");
        const location = optionalString(obj, "location");
        const attendees = optionalStringArray(obj, "attendees");

        if (summary !== undefined) {
          body.summary = summary;
        }

        if (start !== undefined) {
          body.start = toEventTime(start, allDay, timeZone);
        }

        if (end !== undefined) {
          body.end = toEventTime(end, allDay, timeZone);
        }

        if (description !== undefined) {
          body.description = description;
        }

        if (location !== undefined) {
          body.location = location;
        }

        if (attendees !== undefined) {
          body.attendees = attendees.map((email) => ({ email }));
        }

        return calendarRequest(
          ctx,
          `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
          {
            method: "PATCH",
            query: { sendUpdates: optionalString(obj, "sendUpdates") },
            body,
          },
        );
      },
    },
    {
      name: "delete_event",
      description: "Delete a Google Calendar event.",
      parameters: {
        type: "object",
        properties: {
          calendarId: { type: "string", description: 'Calendar ID (defaults to "primary").' },
          eventId: { type: "string", description: "Event ID to delete." },
          sendUpdates: {
            type: "string",
            description: 'Who receives cancellation notices: "all", "externalOnly", or "none".',
          },
        },
        required: ["eventId"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const calendarId = optionalString(obj, "calendarId") ?? "primary";
        const eventId = requireString(obj, "eventId");

        return calendarRequest(
          ctx,
          `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
          {
            method: "DELETE",
            query: { sendUpdates: optionalString(obj, "sendUpdates") },
          },
        );
      },
    },
    {
      name: "free_busy",
      description: "Query busy time windows for one or more calendars.",
      parameters: {
        type: "object",
        properties: {
          timeMin: { type: "string", description: "RFC3339 start of query window." },
          timeMax: { type: "string", description: "RFC3339 end of query window." },
          calendarIds: {
            type: "array",
            items: { type: "string" },
            description: 'Calendar IDs to check (defaults to ["primary"]).',
          },
          timeZone: { type: "string", description: "Optional IANA time zone." },
        },
        required: ["timeMin", "timeMax"],
        additionalProperties: false,
      },
      async execute(params, ctx) {
        const obj = asObject(params);
        const calendarIds = optionalStringArray(obj, "calendarIds") ?? ["primary"];
        const timeZone = optionalString(obj, "timeZone");

        return calendarRequest(ctx, "/freeBusy", {
          method: "POST",
          body: {
            timeMin: requireString(obj, "timeMin"),
            timeMax: requireString(obj, "timeMax"),
            ...(timeZone !== undefined ? { timeZone } : {}),
            items: calendarIds.map((id) => ({ id })),
          },
        });
      },
    },
  ],
} satisfies TetherboxModule;
