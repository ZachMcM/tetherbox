import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
  customOAuthLoginSchema,
  type CustomOAuthLoginInput,
  type OAuthPresetId,
  type OAuthStatusEntry,
} from "../../../oauth.ts";
import { requestOrigin } from "../origin.ts";
import { oauthPresetParam } from "../../params.ts";
import {
  startPresetOAuthInputSchema,
  type OAuthPresetSummary,
  type StartPresetOAuthInput,
} from "../schemas.ts";

export interface OAuthHandlers {
  getStatus(): Promise<{ presets: OAuthPresetSummary[]; logins: OAuthStatusEntry[] }>;
  startPreset(
    preset: OAuthPresetId,
    input: StartPresetOAuthInput,
    origin: string,
  ): Promise<{ authorizationUrl: string }>;
  startCustom(input: CustomOAuthLoginInput, origin: string): Promise<{ authorizationUrl: string }>;
  logout(target: string): Promise<void>;
}

export function createOAuthRoutes(handlers: OAuthHandlers) {
  return new Hono()
    .get("/oauth/status", async (c) => c.json(await handlers.getStatus(), 200))
    .post(
      "/oauth/presets/:preset/start",
      zValidator("param", oauthPresetParam),
      zValidator("json", startPresetOAuthInputSchema),
      async (c) =>
        c.json(
          await handlers.startPreset(
            c.req.valid("param").preset,
            c.req.valid("json"),
            requestOrigin(c.req.url, c.req.raw.headers),
          ),
          200,
        ),
    )
    .post("/oauth/custom/start", zValidator("json", customOAuthLoginSchema), async (c) =>
      c.json(
        await handlers.startCustom(
          c.req.valid("json"),
          requestOrigin(c.req.url, c.req.raw.headers),
        ),
        200,
      ),
    )
    .delete("/oauth/:target", async (c) => {
      await handlers.logout(c.req.param("target"));

      return c.body(null, 204);
    });
}
