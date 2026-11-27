import { hc } from "hono/client";
import type { AppApi } from "./routes.ts";

export interface AppClientOptions {
  baseUrl?: string;
  token?: string;
  fetch?: typeof globalThis.fetch;
}

export function createAppClient(options: AppClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
  const headers: Record<string, string> = {};

  if (options.token !== undefined) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  return hc<AppApi>(`${baseUrl}/api`, {
    headers,
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
  });
}

export type AppClient = ReturnType<typeof createAppClient>;
