import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ModelAuth,
  OAuthAuth,
  OAuthCredential,
  ProviderAuthInteraction,
} from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding";
import { metaProvider } from "@earendil-works/pi-ai/providers/meta";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
import {
  llmOAuthProviders,
  llmProviderSchema,
  type LlmOAuthProviderId,
  type LlmProvider,
  type TurnModelAuth,
} from "@tetherbox/core";
import { z } from "zod";

const REFRESH_MARGIN_MS = 60_000;
const REFRESH_TIMEOUT_MS = 30_000;
const CODEX_JWT_CLAIM = "https://api.openai.com/auth";

const storedCredentialSchema = z.looseObject({
  type: z.literal("oauth"),
  access: z.string().min(1),
  refresh: z.string(),
  expires: z.number(),
});

type AgentAuthFor = (credential: OAuthCredential) => TurnModelAuth;

interface OAuthFlow {
  readonly oauth: OAuthAuth;
  readonly agentAuth: AgentAuthFor;
}

export interface LlmAccess {
  token: string;
  baseUrl: string | undefined;
}

function jwtSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

function isFresh(credential: OAuthCredential): boolean {
  return credential.expires - Date.now() > REFRESH_MARGIN_MS;
}

function placeholder(access: string): AgentAuthFor {
  return () => ({ kind: "placeholder-oauth", access });
}

function codexAgentAuth(credential: OAuthCredential): TurnModelAuth {
  const accountId = z.string().min(1).parse(credential.accountId);
  const access = [
    jwtSegment({ alg: "none", typ: "JWT" }),
    jwtSegment({ [CODEX_JWT_CLAIM]: { chatgpt_account_id: accountId } }),
    "tetherbox",
  ].join(".");

  return { kind: "placeholder-oauth", access };
}

function tokenFrom(auth: ModelAuth): string | undefined {
  if (auth.apiKey !== undefined) {
    return auth.apiKey;
  }

  const header = Object.entries(auth.headers ?? {}).find(
    ([name]) => name.toLowerCase() === "authorization",
  )?.[1];

  return typeof header === "string" ? /^Bearer\s+(\S+)$/i.exec(header)?.[1] : undefined;
}

/**
 * Anthropic's placeholder keeps the `sk-ant-oat` prefix Pi checks to send subscription requests.
 * Codex's placeholder is a JWT carrying the real ChatGPT account id, which Pi reads to set the
 * account header. Copilot's OAuth credential sets the request base URL in Pi, which would route
 * around the daemon, so the agent uses the run token as an API key instead and the daemon sends
 * the request to the account's endpoint.
 */
const OAUTH_FLOW_SOURCES: Readonly<
  Record<LlmOAuthProviderId, readonly [() => { auth: { oauth?: OAuthAuth } }, AgentAuthFor]>
> = {
  anthropic: [anthropicProvider, placeholder("sk-ant-oat01-tetherbox")],
  "openai-codex": [openaiCodexProvider, codexAgentAuth],
  "github-copilot": [githubCopilotProvider, () => ({ kind: "run-token-key" })],
  xai: [xaiProvider, placeholder("tetherbox-placeholder")],
  "kimi-coding": [kimiCodingProvider, placeholder("tetherbox-placeholder")],
  meta: [metaProvider, placeholder("tetherbox-placeholder")],
  openrouter: [openrouterProvider, placeholder("tetherbox-placeholder")],
};

function createOAuthFlows(): ReadonlyMap<LlmProvider, OAuthFlow> {
  return new Map<LlmProvider, OAuthFlow>(
    llmOAuthProviders.map(({ provider }) => {
      const [createProvider, agentAuth] = OAUTH_FLOW_SOURCES[provider];
      const { oauth } = createProvider().auth;

      if (oauth === undefined) {
        throw new Error(`Pi has no OAuth flow for ${provider}`);
      }

      return [provider, { oauth, agentAuth }];
    }),
  );
}

export interface OAuthLoginSummary {
  provider: LlmProvider;
  expires: number;
}

export interface LlmOAuth {
  login(provider: LlmProvider, interaction: ProviderAuthInteraction): Promise<OAuthLoginSummary>;
  logout(provider: LlmProvider): Promise<void>;
  list(): Promise<OAuthLoginSummary[]>;
  agentAuth(provider: LlmProvider): Promise<TurnModelAuth | undefined>;
  access(provider: LlmProvider): Promise<LlmAccess | undefined>;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * OAuth logins for LLM providers, one JSON file per provider and readable only by the
 * daemon's OS user. Writes for a provider are serialized, and a refresh re-reads the file first,
 * so a rotated refresh token is never used twice.
 */
export function createLlmOAuth(dataDir: string): LlmOAuth {
  const dir = join(dataDir, "llm-oauth");
  const fileFor = (provider: LlmProvider) => join(dir, `${provider}.json`);
  const flows = createOAuthFlows();
  const locks = new Map<LlmProvider, Promise<unknown>>();

  const flowFor = (provider: LlmProvider): OAuthFlow => {
    const flow = flows.get(provider);

    if (flow === undefined) {
      throw new Error(`provider "${provider}" has no OAuth login`);
    }

    return flow;
  };

  const read = async (provider: LlmProvider): Promise<OAuthCredential | undefined> => {
    try {
      return storedCredentialSchema.parse(JSON.parse(await readFile(fileFor(provider), "utf8")));
    } catch (error) {
      if (isMissing(error)) {
        return undefined;
      }

      const message = error instanceof Error ? error.message : String(error);

      throw new Error(`could not read ${fileFor(provider)}: ${message}`, { cause: error });
    }
  };

  const write = async (provider: LlmProvider, credential: OAuthCredential): Promise<void> => {
    await mkdir(dir, { recursive: true, mode: 0o700 });

    const tmpPath = `${fileFor(provider)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;

    try {
      await writeFile(tmpPath, JSON.stringify(credential), { mode: 0o600 });
      await rename(tmpPath, fileFor(provider));
    } catch (error) {
      await rm(tmpPath, { force: true });
      throw error;
    }
  };

  const withLock = <T>(provider: LlmProvider, task: () => Promise<T>): Promise<T> => {
    const next = (locks.get(provider) ?? Promise.resolve()).catch(() => undefined).then(task);

    locks.set(provider, next);

    return next;
  };

  const refreshed = (provider: LlmProvider) =>
    withLock(provider, async () => {
      const stored = await read(provider);

      if (stored === undefined || isFresh(stored)) {
        return stored;
      }

      const credential = await flowFor(provider).oauth.refresh(
        stored,
        AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      );

      await write(provider, credential);

      return credential;
    });

  return {
    async login(provider, interaction) {
      const credential = await flowFor(provider).oauth.login(interaction);

      await withLock(provider, () => write(provider, credential));

      return { provider, expires: credential.expires };
    },
    async logout(provider) {
      await withLock(provider, () => rm(fileFor(provider), { force: true }));
    },
    async list() {
      let files: string[];

      try {
        files = await readdir(dir);
      } catch (error) {
        if (isMissing(error)) {
          return [];
        }

        throw error;
      }

      const summaries: OAuthLoginSummary[] = [];

      for (const file of files.filter((name) => name.endsWith(".json")).toSorted()) {
        const provider = llmProviderSchema.parse(file.slice(0, -".json".length));
        const credential = await read(provider);

        if (credential !== undefined) {
          summaries.push({ provider, expires: credential.expires });
        }
      }

      return summaries;
    },
    async agentAuth(provider) {
      const credential = await read(provider);

      return credential === undefined ? undefined : flowFor(provider).agentAuth(credential);
    },
    async access(provider) {
      const stored = await read(provider);
      const credential =
        stored === undefined || isFresh(stored) ? stored : await refreshed(provider);

      if (credential === undefined) {
        return undefined;
      }

      const auth = await flowFor(provider).oauth.toAuth(credential);
      const token = tokenFrom(auth);

      if (token === undefined) {
        throw new Error(`the ${provider} login produced no bearer token`);
      }

      return { token, baseUrl: auth.baseUrl };
    },
  };
}
