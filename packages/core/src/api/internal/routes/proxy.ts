import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { LlmProvider } from "../../../llm-auth.ts";
import { llmProviderParam } from "../../params.ts";
import type { InternalEnv, RunContext } from "../run-context.ts";

export interface ProxyHandlers {
  withSecret(run: RunContext, request: Request): Promise<Response>;
  llm(run: RunContext, provider: LlmProvider, request: Request): Promise<Response>;
}

export function createProxyRoutes(handlers: ProxyHandlers) {
  return new Hono<InternalEnv>()
    .all("/proxy/*", (c) => handlers.withSecret(c.get("run"), c.req.raw))
    .all("/llm/:provider/*", zValidator("param", llmProviderParam), (c) =>
      handlers.llm(c.get("run"), c.req.valid("param").provider, c.req.raw),
    );
}
