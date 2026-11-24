import type { SecretStore } from "./secret-store.ts";

/**
 * The agent's Pi session points every provider's base URL at `/llm/<provider>` and uses its run
 * token as the API key, so provider credentials never leave the daemon.
 */
export async function proxyLlm(
  _store: SecretStore,
  provider: string,
  _request: Request,
): Promise<Response> {
  // TODO: Map each provider to its upstream base URL and BYO-subscription credential (API key or
  // OAuth token for OpenCode Go, Codex, and similar), refresh OAuth tokens, and stream the response.
  return Response.json({ error: `LLM proxy for ${provider} is not implemented` }, { status: 501 });
}
