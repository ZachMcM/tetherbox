import { entryNameSchema, profileIdSchema, webhookPath } from "@tetherbox/core";
import { Hono } from "hono";
import type { ProfileRegistry } from "../../profiles/registry.ts";
import type { SecretStore } from "../../credentials/secret-store.ts";
import type { TurnRunner } from "../../sessions/turns.ts";
import { verifyWebhook } from "./webhook-verify.ts";

export interface PublicServerDeps {
  registry: ProfileRegistry;
  secrets: SecretStore;
  turns: TurnRunner;
}

function parseBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/**
 * Served on localhost and exposed through Tailscale Funnel. Everything here is reachable from the
 * internet, so routes only accept input that can be verified.
 */
export function createPublicServer({ registry, secrets, turns }: PublicServerDeps) {
  return new Hono()
    .get("/health", (c) => c.json({ ok: true }))
    .post(webhookPath(":profileId", ":name"), async (c) => {
      const profileId = profileIdSchema.safeParse(c.req.param("profileId"));
      const name = entryNameSchema.safeParse(c.req.param("name"));
      const profile = profileId.success ? registry.get(profileId.data) : undefined;
      const hook = name.success ? profile?.webhooks.get(name.data) : undefined;

      if (profile === undefined || hook === undefined || !name.success) {
        return c.json({ error: "not found" }, 404);
      }

      const body = await c.req.text();

      if (!(await verifyWebhook(hook.verify, c.req.raw.headers, body, secrets))) {
        return c.json({ error: "signature mismatch" }, 401);
      }

      const sessionId = turns.enqueue(profile.id, {
        kind: "webhook",
        hook: name.data,
        prompt: hook.prompt,
        payload: parseBody(body),
      });

      return c.json({ accepted: true, sessionId }, 202);
    });
}
