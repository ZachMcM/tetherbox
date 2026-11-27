import { createAppClient } from "@tetherbox/core/app";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const appClient = createAppClient();

export const queryKeys = {
  auth: ["auth"] as const,
  settings: ["settings"] as const,
  profiles: ["profiles"] as const,
  profile: (profileId: string) => ["profiles", profileId] as const,
  starters: ["starters"] as const,
  sessions: ["sessions"] as const,
  session: (sessionId: string) => ["sessions", sessionId] as const,
  secrets: ["secrets"] as const,
  llmStatus: ["llm", "status"] as const,
  llmModels: ["llm", "models"] as const,
  oauthStatus: ["oauth", "status"] as const,
};

let onUnauthorized: (() => void) | undefined;

export function registerUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

type ReadableResponse = Pick<Response, "status" | "text">;
type ErrorResponse = ReadableResponse & { ok: false };
type OkJsonResponse<T> = ReadableResponse & {
  ok: true;
  json(): Promise<T>;
};

async function readErrorMessage(response: ReadableResponse): Promise<string> {
  const text = await response.text();

  if (text === "") {
    return `Request failed with status ${response.status}`;
  }

  try {
    const parsed: unknown = JSON.parse(text);

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof parsed.error === "string"
    ) {
      return parsed.error;
    }
  } catch {
    // Plain text error body.
  }

  return text;
}

function handleStatus(status: number): void {
  if (status === 401) {
    onUnauthorized?.();
  }
}

export async function unwrapJson<T>(response: OkJsonResponse<T> | ErrorResponse): Promise<T> {
  if (!response.ok) {
    handleStatus(response.status);
    throw new ApiError(response.status, await readErrorMessage(response));
  }

  return response.json();
}

export async function expectOk(response: Pick<Response, "ok" | "status" | "text">): Promise<void> {
  if (!response.ok) {
    handleStatus(response.status);
    throw new ApiError(response.status, await readErrorMessage(response));
  }
}

export async function getAuthStatus(): Promise<{ authenticated: boolean }> {
  const response = await fetch("/api/auth/status", { credentials: "same-origin" });

  await expectOk(response);

  const body: unknown = await response.json();
  const authenticated =
    typeof body === "object" &&
    body !== null &&
    "authenticated" in body &&
    body.authenticated === true;

  return { authenticated };
}

export async function loginWithToken(token: string): Promise<void> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response));
  }
}

export async function logout(): Promise<void> {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  });

  await expectOk(response);
}
