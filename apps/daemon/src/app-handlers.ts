import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  getLlmOAuthProvider,
  getOAuthProvider,
  llmProviderIds,
  oauthPresets,
  RpcError,
  sessionIdSchema,
  supportedLlmAuthKinds,
  type AppApiHandlers,
  type ProfileDetail,
  type ProfileId,
  type ProfileSummary,
  type SessionId,
  type SessionRecord,
} from "@tetherbox/core";
import type { DaemonConfig } from "./config.ts";
import type { DaemonDb } from "./db.ts";
import type { DaemonEventBus } from "./events.ts";
import { listAvailableLlmModels, llmApiKeyProviders } from "./llm-models.ts";
import type { LlmOAuth } from "./llm-oauth.ts";
import type { LlmWebAuthManager } from "./llm-web-auth.ts";
import { formatExpiry, toOAuthStatusEntry, type OAuthStore } from "./oauth.ts";
import type { Poller } from "./poller.ts";
import {
  createProfileOnDisk,
  deleteProfileOnDisk,
  listStarterSummaries,
  readProfileMemoryFile,
  updateProfileOnDisk,
  writeProfileMemoryFile,
} from "./profile-service.ts";
import { loadProfile, type LoadedProfile, type ProfileRegistry } from "./profiles.ts";
import type { ReminderStore } from "./reminders.ts";
import type { Scheduler } from "./scheduler.ts";
import type { SecretStore } from "./secret-store.ts";
import { readSessionTranscript, removeSessionTranscript } from "./transcript.ts";
import { DEFAULT_SESSION_TITLE, sessionTitleFromText, type TurnRunner } from "./turns.ts";
import type { VapidKeys } from "./vapid.ts";

export interface AppHandlerDeps {
  config: DaemonConfig;
  vapidKeys: VapidKeys;
  db: DaemonDb;
  events: DaemonEventBus;
  registry: ProfileRegistry;
  scheduler: Scheduler;
  poller: Poller;
  reminders: ReminderStore;
  turns: TurnRunner;
  secrets: SecretStore;
  llmOAuth: LlmOAuth;
  llmWebAuth: LlmWebAuthManager;
  oauth: OAuthStore;
}

function toProfileSummary(
  profile: LoadedProfile,
  poller: Poller,
  reminders: ReminderStore,
): ProfileSummary {
  return {
    id: profile.id,
    config: profile.config,
    cronCount: profile.cron.size,
    webhookCount: profile.webhooks.size,
    pollJobCount: poller.list(profile.id).length,
    reminderCount: reminders.list(profile.id).length,
  };
}

async function toProfileDetail(
  profile: LoadedProfile,
  poller: Poller,
  reminders: ReminderStore,
): Promise<ProfileDetail> {
  const [memory, load] = await Promise.all([
    readProfileMemoryFile(profile.dir),
    loadProfile(profile.id, profile.dir),
  ]);

  return {
    id: profile.id,
    config: profile.config,
    memory,
    cron: [...profile.cron.entries()].map(([name, job]) => ({ name, job })),
    webhooks: [...profile.webhooks.entries()].map(([name, webhook]) => ({ name, webhook })),
    pollJobs: poller.list(profile.id),
    reminders: reminders.list(profile.id),
    issues: load.issues,
  };
}

export function createAppHandlers(deps: AppHandlerDeps): AppApiHandlers {
  const {
    config,
    vapidKeys,
    db,
    events,
    registry,
    scheduler,
    poller,
    reminders,
    turns,
    secrets,
    llmOAuth,
    llmWebAuth,
    oauth,
  } = deps;

  const requireProfile = (id: ProfileId): LoadedProfile => {
    const profile = registry.get(id);

    if (profile === undefined) {
      throw new RpcError(404, `profile "${id}" not found`);
    }

    return profile;
  };

  const requireSession = (sessionId: SessionId): SessionRecord => {
    const session = db.getSession(sessionId);

    if (session === undefined) {
      throw new RpcError(404, `session "${sessionId}" not found`);
    }

    return session;
  };

  const reloadProfileOrThrow = async (id: ProfileId): Promise<LoadedProfile> => {
    const load = await registry.reload(id);

    if (load.kind === "invalid") {
      throw new RpcError(400, load.issues.map((issue) => issue.message).join("; "));
    }

    scheduler.sync(load.profile);

    return load.profile;
  };

  return {
    getSettings() {
      return db.getAppSettings();
    },
    updateSettings(input) {
      return db.updateAppSettings(input);
    },

    listProfiles() {
      return registry.all().map((profile) => toProfileSummary(profile, poller, reminders));
    },
    async getProfile(id) {
      return toProfileDetail(requireProfile(id), poller, reminders);
    },
    async createProfile(input) {
      await createProfileOnDisk(config.profilesDir, input);

      const loaded = await reloadProfileOrThrow(input.id);

      return toProfileDetail(loaded, poller, reminders);
    },
    async updateProfile(id, input) {
      requireProfile(id);
      await updateProfileOnDisk(config.profilesDir, id, input);

      const loaded = await reloadProfileOrThrow(id);

      return toProfileDetail(loaded, poller, reminders);
    },
    async updateProfileMemory(id, content) {
      const profile = requireProfile(id);

      await writeProfileMemoryFile(profile.dir, content);

      return { content };
    },
    async deleteProfile(id) {
      requireProfile(id);
      scheduler.remove(id);

      const existingIds = db.listSessions(id).map((session) => session.id);

      try {
        await turns.cancelProfile(id, existingIds);
        poller.cancelByProfile(id);
        reminders.cancelByProfile(id);

        const deletedIds = db.deleteSessionsByProfile(id);

        await rm(join(config.sessionsDir, id), { recursive: true, force: true });
        await deleteProfileOnDisk(config.profilesDir, id);
        await registry.remove(id);

        for (const sessionId of deletedIds) {
          events.emit({ kind: "session_deleted", profileId: id, sessionId });
        }
      } finally {
        turns.finishProfileDeletion(id);
      }
    },
    listStarters() {
      return listStarterSummaries();
    },
    cancelPollJob(profileId, name) {
      requireProfile(profileId);

      return { cancelled: poller.cancel(profileId, name) };
    },
    cancelReminder(profileId, name) {
      requireProfile(profileId);

      return { cancelled: reminders.cancel(profileId, name) };
    },

    listSessions(profileId) {
      return db.listSessions(profileId);
    },
    createSession(profileId, input) {
      requireProfile(profileId);

      if (input.prompt !== undefined) {
        const sessionId = turns.enqueue(
          profileId,
          { kind: "user", text: input.prompt },
          { model: input.model },
        );
        const created =
          input.title !== undefined
            ? db.renameSession(sessionId, input.title)
            : db.getSession(sessionId);

        if (created === undefined) {
          throw new RpcError(404, `session "${sessionId}" not found`);
        }

        if (input.title !== undefined) {
          events.emit({ kind: "session_updated", session: created });
        }

        return created;
      }

      const sessionId = sessionIdSchema.parse(randomUUID());
      const created = db.createSession({
        id: sessionId,
        profileId,
        title: input.title ?? DEFAULT_SESSION_TITLE,
        triggerKind: "user",
        model: input.model ?? null,
      });

      events.emit({ kind: "session_updated", session: created });

      return created;
    },
    async getSession(sessionId) {
      const session = requireSession(sessionId);
      const entries = await readSessionTranscript(config.sessionsDir, session.profileId, sessionId);

      return { session, entries };
    },
    sendSessionMessage(sessionId, { text, model }) {
      const session = requireSession(sessionId);

      requireProfile(session.profileId);

      if (session.title === DEFAULT_SESSION_TITLE) {
        const renamed = db.renameSession(sessionId, sessionTitleFromText(text));

        if (renamed !== undefined) {
          events.emit({ kind: "session_updated", session: renamed });
        }
      }

      turns.enqueue(session.profileId, { kind: "user", text }, { sessionId, model });

      return { accepted: true, sessionId };
    },
    abortSession(sessionId) {
      requireSession(sessionId);

      return { aborted: turns.abort(sessionId) };
    },
    updateSession(sessionId, input) {
      let session = requireSession(sessionId);

      if (input.title !== undefined) {
        session = db.renameSession(sessionId, input.title) ?? session;
      }

      if (input.markRead === true) {
        session = db.markSessionRead(sessionId) ?? session;
      }

      if (input.model !== undefined) {
        session = db.updateSessionModel(sessionId, input.model) ?? session;
      }

      events.emit({ kind: "session_updated", session });

      return session;
    },
    async deleteSession(sessionId) {
      const session = requireSession(sessionId);

      await turns.cancelSession(sessionId);
      poller.cancelBySession(sessionId);
      reminders.cancelBySession(sessionId);
      db.deleteSession(sessionId);
      await removeSessionTranscript(config.sessionsDir, session.profileId, sessionId);
      events.emit({ kind: "session_deleted", profileId: session.profileId, sessionId });
    },

    listSecrets() {
      return secrets.list();
    },
    async setSecret(key, input) {
      await secrets.set(key, { value: input.value, binding: input.binding });

      return { key, binding: input.binding };
    },
    deleteSecret(key) {
      return secrets.delete(key);
    },

    async getLlmStatus() {
      const [storedSecrets, oauthLoginsRaw] = await Promise.all([secrets.list(), llmOAuth.list()]);
      const apiKeyProviders = llmApiKeyProviders(storedSecrets);
      const oauthLogins = oauthLoginsRaw.map((login) => ({
        provider: login.provider,
        expires: formatExpiry(login.expires),
      }));
      const oauthByProvider = new Map(oauthLogins.map((login) => [login.provider, login.expires]));
      const providers = llmProviderIds.map((provider) => {
        const oauthProvider = getLlmOAuthProvider(provider);
        const oauthExpires = oauthByProvider.get(provider);

        return {
          provider,
          supportedAuth: supportedLlmAuthKinds(provider),
          hasApiKey: apiKeyProviders.has(provider),
          ...(oauthProvider !== undefined ? { oauthLabel: oauthProvider.label } : {}),
          ...(oauthExpires !== undefined ? { oauthExpires } : {}),
        };
      });

      return { providers, oauthLogins };
    },
    async listLlmModels() {
      return { models: await listAvailableLlmModels({ secrets, llmOAuth }) };
    },
    startLlmOAuth(provider, origin) {
      return llmWebAuth.start(provider, origin);
    },
    getLlmOAuthFlow(flowId) {
      return llmWebAuth.get(flowId);
    },
    respondLlmOAuthFlow(flowId, value) {
      return llmWebAuth.respond(flowId, value);
    },
    cancelLlmOAuthFlow(flowId) {
      return llmWebAuth.cancel(flowId);
    },
    logoutLlmOAuth(provider) {
      return llmOAuth.logout(provider);
    },

    async getOAuthStatus() {
      const [loginsRaw, storedSecrets] = await Promise.all([oauth.list(), secrets.list()]);
      const secretKeys = new Set(storedSecrets.map((entry) => entry.key));
      const presets = oauthPresets.map((preset) => {
        const provider = getOAuthProvider(preset.provider);

        return {
          id: preset.id,
          provider: preset.provider,
          label: preset.label,
          secretKey: preset.secretKey,
          domains: preset.domains,
          defaultScopeMode: preset.defaultScopeMode,
          clientIdSecretKey: provider.clientIdSecretKey,
          clientSecretSecretKey: provider.clientSecretSecretKey,
          hasClientCredentials:
            secretKeys.has(provider.clientIdSecretKey) &&
            secretKeys.has(provider.clientSecretSecretKey),
        };
      });

      return { presets, logins: loginsRaw.map(toOAuthStatusEntry) };
    },
    startPresetOAuth(preset, input, origin) {
      return oauth.startWebPresetLogin(preset, {
        redirectUri: `${origin}/api/oauth/callback`,
        scopeMode: input.scopeMode,
      });
    },
    startCustomOAuth(input, origin) {
      return oauth.startWebCustomLogin(input, `${origin}/api/oauth/callback`);
    },
    async logoutOAuth(target) {
      await oauth.logout(target);
    },

    getVapidPublicKey() {
      return { publicKey: vapidKeys.publicKey };
    },
    upsertPushSubscription(input) {
      db.upsertPushSubscription({
        ...input,
        createdAt: new Date().toISOString(),
      });
    },
    deletePushSubscription(endpoint) {
      return { deleted: db.deletePushSubscription(endpoint) };
    },
  };
}
