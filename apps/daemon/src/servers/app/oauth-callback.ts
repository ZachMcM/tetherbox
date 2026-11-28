import type { Context } from "hono";
import { renderOAuthCallbackHtml } from "../../credentials/oauth-flow.ts";
import type { OAuthStore } from "../../credentials/oauth-store.ts";

export function createOAuthCallbackHandler(oauth: OAuthStore) {
  return async (c: Context) => {
    try {
      const summary = await oauth.completeWebLogin({
        state: c.req.query("state") ?? null,
        code: c.req.query("code") ?? null,
        error: c.req.query("error") ?? null,
        errorDescription: c.req.query("error_description") ?? null,
      });

      return c.html(
        renderOAuthCallbackHtml(
          "Tetherbox connected",
          `Stored OAuth credentials for ${summary.secretKey}. You can close this tab or return to Tetherbox.`,
          { returnLink: true },
        ),
        200,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      return c.html(
        renderOAuthCallbackHtml("Authorization failed", message, { returnLink: true }),
        400,
      );
    }
  };
}
