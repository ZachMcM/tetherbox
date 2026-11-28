import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { LlmOAuthStatusEntry, LlmProvider } from "../../../llm-auth.ts";
import { modelRefSchema, type ModelRef } from "../../../profile.ts";
import { requestOrigin } from "../origin.ts";
import { llmProviderParam } from "../../params.ts";
import {
  llmOAuthRespondInputSchema,
  type LlmModelOption,
  type LlmOAuthFlowState,
  type LlmProviderStatus,
} from "../schemas.ts";

export interface LlmHandlers {
  getStatus(): Promise<{ providers: LlmProviderStatus[]; oauthLogins: LlmOAuthStatusEntry[] }>;
  listModels(): Promise<{ models: LlmModelOption[] }>;
  startOAuth(provider: LlmProvider, origin: string): Promise<LlmOAuthFlowState>;
  getOAuthFlow(flowId: string): LlmOAuthFlowState;
  respondOAuthFlow(flowId: string, value: string): LlmOAuthFlowState;
  cancelOAuthFlow(flowId: string): { cancelled: boolean };
  logoutOAuth(provider: LlmProvider): Promise<void>;
  addFavoriteModel(model: ModelRef): void;
  removeFavoriteModel(model: ModelRef): void;
}

export function createLlmRoutes(handlers: LlmHandlers) {
  return new Hono()
    .get("/llm/status", async (c) => c.json(await handlers.getStatus(), 200))
    .get("/llm/models", async (c) => c.json(await handlers.listModels(), 200))
    .post("/llm/oauth/:provider/start", zValidator("param", llmProviderParam), async (c) =>
      c.json(
        {
          flow: await handlers.startOAuth(
            c.req.valid("param").provider,
            requestOrigin(c.req.url, c.req.raw.headers),
          ),
        },
        200,
      ),
    )
    .get("/llm/oauth/flows/:flowId", (c) =>
      c.json({ flow: handlers.getOAuthFlow(c.req.param("flowId")) }, 200),
    )
    .post("/llm/oauth/flows/:flowId/respond", zValidator("json", llmOAuthRespondInputSchema), (c) =>
      c.json(
        { flow: handlers.respondOAuthFlow(c.req.param("flowId"), c.req.valid("json").value) },
        200,
      ),
    )
    .post("/llm/oauth/flows/:flowId/cancel", (c) =>
      c.json(handlers.cancelOAuthFlow(c.req.param("flowId")), 200),
    )
    .delete("/llm/oauth/:provider", zValidator("param", llmProviderParam), async (c) => {
      await handlers.logoutOAuth(c.req.valid("param").provider);

      return c.body(null, 204);
    })
    .put("/llm/favorites", zValidator("json", modelRefSchema), (c) => {
      handlers.addFavoriteModel(c.req.valid("json"));

      return c.body(null, 204);
    })
    .delete("/llm/favorites", zValidator("json", modelRefSchema), (c) => {
      handlers.removeFavoriteModel(c.req.valid("json"));

      return c.body(null, 204);
    });
}
