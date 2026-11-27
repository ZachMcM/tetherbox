import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
  entryNameSchema,
  profileIdSchema,
  secretKeySchema,
  sessionIdSchema,
  type EntryName,
  type ProfileId,
  type SecretKey,
  type SessionId,
} from "../ids.ts";
import { llmProviderSchema, type LlmOAuthStatusEntry, type LlmProvider } from "../llm-auth.ts";
import {
  customOAuthLoginSchema,
  oauthPresetSchema,
  type CustomOAuthLoginInput,
  type OAuthPresetId,
  type OAuthStatusEntry,
} from "../oauth.ts";
import { modelRefSchema, type ModelRef } from "../profile.ts";
import type { SecretListEntry } from "../secrets.ts";
import {
  pushSubscriptionInputSchema,
  type PushSubscriptionInput,
  type SessionRecord,
  type TranscriptEntry,
} from "../session.ts";
import { RpcError } from "./api.ts";
import {
  cliAuthRespondInputSchema,
  createProfileInputSchema,
  createSessionInputSchema,
  deletePushSubscriptionInputSchema,
  llmOAuthRespondInputSchema,
  sendSessionMessageInputSchema,
  setSecretInputSchema,
  startPresetOAuthInputSchema,
  updateAppSettingsInputSchema,
  updateMemoryInputSchema,
  updateProfileInputSchema,
  updateSessionInputSchema,
  type AppSettings,
  type CreateProfileInput,
  type CreateSessionInput,
  type LlmModelOption,
  type LlmOAuthFlowState,
  type LlmProviderStatus,
  type OAuthPresetSummary,
  type ProfileDetail,
  type ProfileSummary,
  type SetSecretInput,
  type StarterCliStatusEntry,
  type StarterSummary,
  type StartPresetOAuthInput,
  type UpdateAppSettingsInput,
  type UpdateProfileInput,
  type SendSessionMessageInput,
  type UpdateSessionInput,
} from "./app-schemas.ts";
import type { CliAuthFlowState, CliInstallJobState } from "../cli.ts";

export * from "./app-schemas.ts";

const profileIdParam = z.object({ profileId: profileIdSchema });
const sessionIdParam = z.object({ sessionId: sessionIdSchema });
const profileEntryParam = z.object({ profileId: profileIdSchema, name: entryNameSchema });
const secretKeyParam = z.object({ key: secretKeySchema });
const llmProviderParam = z.object({ provider: llmProviderSchema });
const oauthPresetParam = z.object({ preset: oauthPresetSchema });
const starterIdParam = z.object({ starterId: z.string().min(1) });
const profileStarterParam = z.object({ profileId: profileIdSchema, starterId: z.string().min(1) });

export interface AppApiHandlers {
  getSettings(): AppSettings;
  updateSettings(input: UpdateAppSettingsInput): AppSettings;

  listProfiles(): Promise<ProfileSummary[]> | ProfileSummary[];
  getProfile(id: ProfileId): Promise<ProfileDetail>;
  createProfile(input: CreateProfileInput): Promise<ProfileDetail>;
  updateProfile(id: ProfileId, input: UpdateProfileInput): Promise<ProfileDetail>;
  updateProfileMemory(id: ProfileId, content: string): Promise<{ content: string }>;
  deleteProfile(id: ProfileId): Promise<void>;
  updateProfileStarter(id: ProfileId, starterId: string): Promise<ProfileDetail>;
  listStarters(): StarterSummary[];
  removeLibraryStarter(starterId: string): Promise<void>;
  listCliStatuses(): Promise<StarterCliStatusEntry[]>;
  startCliInstall(starterId: string): CliInstallJobState;
  getCliInstallJob(jobId: string): CliInstallJobState;
  startCliAuth(starterId: string): Promise<CliAuthFlowState>;
  getCliAuthFlow(flowId: string): CliAuthFlowState;
  respondCliAuthFlow(flowId: string, value: string): CliAuthFlowState;
  cancelCliAuthFlow(flowId: string): { cancelled: boolean };
  cancelPollJob(profileId: ProfileId, name: EntryName): { cancelled: boolean };
  cancelReminder(profileId: ProfileId, name: EntryName): { cancelled: boolean };

  listSessions(profileId?: ProfileId): SessionRecord[];
  createSession(profileId: ProfileId, input: CreateSessionInput): SessionRecord;
  getSession(sessionId: SessionId): Promise<{ session: SessionRecord; entries: TranscriptEntry[] }>;
  sendSessionMessage(
    sessionId: SessionId,
    input: SendSessionMessageInput,
  ): { accepted: true; sessionId: SessionId };
  abortSession(sessionId: SessionId): { aborted: boolean };
  updateSession(sessionId: SessionId, input: UpdateSessionInput): SessionRecord;
  deleteSession(sessionId: SessionId): Promise<void>;

  listSecrets(): Promise<SecretListEntry[]>;
  setSecret(key: SecretKey, input: SetSecretInput): Promise<SecretListEntry>;
  deleteSecret(key: SecretKey): Promise<void>;

  getLlmStatus(): Promise<{
    providers: LlmProviderStatus[];
    oauthLogins: LlmOAuthStatusEntry[];
  }>;
  listLlmModels(): Promise<{ models: LlmModelOption[] }>;
  startLlmOAuth(provider: LlmProvider, origin: string): Promise<LlmOAuthFlowState>;
  getLlmOAuthFlow(flowId: string): LlmOAuthFlowState;
  respondLlmOAuthFlow(flowId: string, value: string): LlmOAuthFlowState;
  cancelLlmOAuthFlow(flowId: string): { cancelled: boolean };
  logoutLlmOAuth(provider: LlmProvider): Promise<void>;
  addFavoriteModel(model: ModelRef): void;
  removeFavoriteModel(model: ModelRef): void;

  getOAuthStatus(): Promise<{
    presets: OAuthPresetSummary[];
    logins: OAuthStatusEntry[];
  }>;
  startPresetOAuth(
    preset: OAuthPresetId,
    input: StartPresetOAuthInput,
    origin: string,
  ): Promise<{ authorizationUrl: string }>;
  startCustomOAuth(
    input: CustomOAuthLoginInput,
    origin: string,
  ): Promise<{ authorizationUrl: string }>;
  logoutOAuth(target: string): Promise<void>;

  getVapidPublicKey(): { publicKey: string };
  upsertPushSubscription(input: PushSubscriptionInput): void;
  deletePushSubscription(endpoint: string): { deleted: boolean };
}

function lastHeaderEntry(header: string | null | undefined): string | undefined {
  if (header === null || header === undefined) {
    return undefined;
  }

  const entry = header.split(",").at(-1)?.trim();

  return entry === "" ? undefined : entry;
}

export function parseForwardedProto(
  header: string | null | undefined,
): "http" | "https" | undefined {
  const value = lastHeaderEntry(header)?.toLowerCase();

  return value === "http" || value === "https" ? value : undefined;
}

function parseValidHost(raw: string | undefined): string | undefined {
  if (raw === undefined || /[/?#@\\\s]/.test(raw)) {
    return undefined;
  }

  const parsed = URL.parse(`http://${raw}`);

  if (parsed === null || parsed.hostname === "" || parsed.pathname !== "/") {
    return undefined;
  }

  return parsed.host;
}

function requestOrigin(url: string, headers: Headers): string {
  const parsed = new URL(url);
  const rawForwardedProto = headers.get("x-forwarded-proto");
  const forwardedProto = parseForwardedProto(rawForwardedProto);

  if (rawForwardedProto !== null && forwardedProto === undefined) {
    throw new RpcError(400, "invalid x-forwarded-proto header");
  }

  const rawForwardedHost = headers.get("x-forwarded-host");
  const forwardedHost = parseValidHost(lastHeaderEntry(rawForwardedHost));

  if (rawForwardedHost !== null && forwardedHost === undefined) {
    throw new RpcError(400, "invalid x-forwarded-host header");
  }

  const requestProto = parsed.protocol === "https:" ? "https" : "http";
  const proto = forwardedProto ?? requestProto;
  const host = forwardedHost ?? parseValidHost(headers.get("host") ?? undefined) ?? parsed.host;

  return `${proto}://${host}`;
}

/**
 * Typed Hono RPC routes mounted under `/api` on the daemon's private app server. Both `apps/web`
 * and thin CLI shims use the inferred type through `createAppClient`.
 */
export function createAppApi(handlers: AppApiHandlers) {
  return new Hono()
    .onError((error, c) => {
      if (error instanceof RpcError) {
        return c.json({ error: error.message }, error.status);
      }

      console.error(error);

      return c.json(
        { error: error instanceof Error ? error.message : "Internal Server Error" },
        500,
      );
    })
    .get("/settings", (c) => c.json(handlers.getSettings(), 200))
    .patch("/settings", zValidator("json", updateAppSettingsInputSchema), (c) =>
      c.json(handlers.updateSettings(c.req.valid("json")), 200),
    )
    .get("/profiles", async (c) => c.json({ profiles: await handlers.listProfiles() }, 200))
    .post("/profiles", zValidator("json", createProfileInputSchema), async (c) =>
      c.json({ profile: await handlers.createProfile(c.req.valid("json")) }, 201),
    )
    .get("/profiles/:profileId", zValidator("param", profileIdParam), async (c) =>
      c.json({ profile: await handlers.getProfile(c.req.valid("param").profileId) }, 200),
    )
    .patch(
      "/profiles/:profileId",
      zValidator("param", profileIdParam),
      zValidator("json", updateProfileInputSchema),
      async (c) =>
        c.json(
          {
            profile: await handlers.updateProfile(
              c.req.valid("param").profileId,
              c.req.valid("json"),
            ),
          },
          200,
        ),
    )
    .put(
      "/profiles/:profileId/memory",
      zValidator("param", profileIdParam),
      zValidator("json", updateMemoryInputSchema),
      async (c) =>
        c.json(
          await handlers.updateProfileMemory(
            c.req.valid("param").profileId,
            c.req.valid("json").content,
          ),
          200,
        ),
    )
    .delete("/profiles/:profileId", zValidator("param", profileIdParam), async (c) => {
      await handlers.deleteProfile(c.req.valid("param").profileId);

      return c.body(null, 204);
    })
    .delete("/profiles/:profileId/poll-jobs/:name", zValidator("param", profileEntryParam), (c) => {
      const { profileId, name } = c.req.valid("param");

      return c.json(handlers.cancelPollJob(profileId, name), 200);
    })
    .delete("/profiles/:profileId/reminders/:name", zValidator("param", profileEntryParam), (c) => {
      const { profileId, name } = c.req.valid("param");

      return c.json(handlers.cancelReminder(profileId, name), 200);
    })
    .post(
      "/profiles/:profileId/starters/:starterId/update",
      zValidator("param", profileStarterParam),
      async (c) => {
        const { profileId, starterId } = c.req.valid("param");

        return c.json({ profile: await handlers.updateProfileStarter(profileId, starterId) }, 200);
      },
    )
    .get("/starters", (c) => c.json({ starters: handlers.listStarters() }, 200))
    .delete("/starters/:starterId", zValidator("param", starterIdParam), async (c) => {
      await handlers.removeLibraryStarter(c.req.valid("param").starterId);

      return c.body(null, 204);
    })
    .get("/clis/status", async (c) => c.json({ clis: await handlers.listCliStatuses() }, 200))
    .post("/clis/:starterId/install", zValidator("param", starterIdParam), (c) =>
      c.json({ job: handlers.startCliInstall(c.req.valid("param").starterId) }, 200),
    )
    .get("/clis/installs/:jobId", (c) =>
      c.json({ job: handlers.getCliInstallJob(c.req.param("jobId")) }, 200),
    )
    .post("/clis/:starterId/auth/start", zValidator("param", starterIdParam), async (c) =>
      c.json({ flow: await handlers.startCliAuth(c.req.valid("param").starterId) }, 200),
    )
    .get("/clis/auth/flows/:flowId", (c) =>
      c.json({ flow: handlers.getCliAuthFlow(c.req.param("flowId")) }, 200),
    )
    .post("/clis/auth/flows/:flowId/respond", zValidator("json", cliAuthRespondInputSchema), (c) =>
      c.json(
        { flow: handlers.respondCliAuthFlow(c.req.param("flowId"), c.req.valid("json").value) },
        200,
      ),
    )
    .post("/clis/auth/flows/:flowId/cancel", (c) =>
      c.json(handlers.cancelCliAuthFlow(c.req.param("flowId")), 200),
    )
    .get(
      "/sessions",
      zValidator("query", z.object({ profileId: profileIdSchema.optional() })),
      (c) => c.json({ sessions: handlers.listSessions(c.req.valid("query").profileId) }, 200),
    )
    .post(
      "/profiles/:profileId/sessions",
      zValidator("param", profileIdParam),
      zValidator("json", createSessionInputSchema),
      (c) =>
        c.json(
          {
            session: handlers.createSession(c.req.valid("param").profileId, c.req.valid("json")),
          },
          201,
        ),
    )
    .get("/sessions/:sessionId", zValidator("param", sessionIdParam), async (c) =>
      c.json(await handlers.getSession(c.req.valid("param").sessionId), 200),
    )
    .post(
      "/sessions/:sessionId/messages",
      zValidator("param", sessionIdParam),
      zValidator("json", sendSessionMessageInputSchema),
      (c) =>
        c.json(
          handlers.sendSessionMessage(c.req.valid("param").sessionId, c.req.valid("json")),
          202,
        ),
    )
    .post("/sessions/:sessionId/abort", zValidator("param", sessionIdParam), (c) =>
      c.json(handlers.abortSession(c.req.valid("param").sessionId), 200),
    )
    .patch(
      "/sessions/:sessionId",
      zValidator("param", sessionIdParam),
      zValidator("json", updateSessionInputSchema),
      (c) =>
        c.json(
          {
            session: handlers.updateSession(c.req.valid("param").sessionId, c.req.valid("json")),
          },
          200,
        ),
    )
    .delete("/sessions/:sessionId", zValidator("param", sessionIdParam), async (c) => {
      await handlers.deleteSession(c.req.valid("param").sessionId);

      return c.body(null, 204);
    })
    .get("/secrets", async (c) => c.json({ secrets: await handlers.listSecrets() }, 200))
    .put(
      "/secrets/:key",
      zValidator("param", secretKeyParam),
      zValidator("json", setSecretInputSchema),
      async (c) =>
        c.json(
          {
            secret: await handlers.setSecret(c.req.valid("param").key, c.req.valid("json")),
          },
          200,
        ),
    )
    .delete("/secrets/:key", zValidator("param", secretKeyParam), async (c) => {
      await handlers.deleteSecret(c.req.valid("param").key);

      return c.body(null, 204);
    })
    .get("/llm/status", async (c) => c.json(await handlers.getLlmStatus(), 200))
    .get("/llm/models", async (c) => c.json(await handlers.listLlmModels(), 200))
    .post("/llm/oauth/:provider/start", zValidator("param", llmProviderParam), async (c) =>
      c.json(
        {
          flow: await handlers.startLlmOAuth(
            c.req.valid("param").provider,
            requestOrigin(c.req.url, c.req.raw.headers),
          ),
        },
        200,
      ),
    )
    .get("/llm/oauth/flows/:flowId", (c) =>
      c.json({ flow: handlers.getLlmOAuthFlow(c.req.param("flowId")) }, 200),
    )
    .post("/llm/oauth/flows/:flowId/respond", zValidator("json", llmOAuthRespondInputSchema), (c) =>
      c.json(
        {
          flow: handlers.respondLlmOAuthFlow(c.req.param("flowId"), c.req.valid("json").value),
        },
        200,
      ),
    )
    .post("/llm/oauth/flows/:flowId/cancel", (c) =>
      c.json(handlers.cancelLlmOAuthFlow(c.req.param("flowId")), 200),
    )
    .delete("/llm/oauth/:provider", zValidator("param", llmProviderParam), async (c) => {
      await handlers.logoutLlmOAuth(c.req.valid("param").provider);

      return c.body(null, 204);
    })
    .put("/llm/favorites", zValidator("json", modelRefSchema), (c) => {
      handlers.addFavoriteModel(c.req.valid("json"));

      return c.body(null, 204);
    })
    .delete("/llm/favorites", zValidator("json", modelRefSchema), (c) => {
      handlers.removeFavoriteModel(c.req.valid("json"));

      return c.body(null, 204);
    })
    .get("/oauth/status", async (c) => c.json(await handlers.getOAuthStatus(), 200))
    .post(
      "/oauth/presets/:preset/start",
      zValidator("param", oauthPresetParam),
      zValidator("json", startPresetOAuthInputSchema),
      async (c) =>
        c.json(
          await handlers.startPresetOAuth(
            c.req.valid("param").preset,
            c.req.valid("json"),
            requestOrigin(c.req.url, c.req.raw.headers),
          ),
          200,
        ),
    )
    .post("/oauth/custom/start", zValidator("json", customOAuthLoginSchema), async (c) =>
      c.json(
        await handlers.startCustomOAuth(
          c.req.valid("json"),
          requestOrigin(c.req.url, c.req.raw.headers),
        ),
        200,
      ),
    )
    .delete("/oauth/:target", async (c) => {
      await handlers.logoutOAuth(c.req.param("target"));

      return c.body(null, 204);
    })
    .get("/push/vapid-key", (c) => c.json(handlers.getVapidPublicKey(), 200))
    .post("/push/subscriptions", zValidator("json", pushSubscriptionInputSchema), (c) => {
      handlers.upsertPushSubscription(c.req.valid("json"));

      return c.body(null, 204);
    })
    .delete("/push/subscriptions", zValidator("json", deletePushSubscriptionInputSchema), (c) =>
      c.json(handlers.deletePushSubscription(c.req.valid("json").endpoint), 200),
    );
}

export type AppApi = ReturnType<typeof createAppApi>;
