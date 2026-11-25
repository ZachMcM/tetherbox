import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  createCodemodeExtension,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  createInternalClient,
  createSecretProxyFetch,
  profileLayout,
  RUN_TOKEN_HEADER,
  type TurnInput,
  type TurnResult,
} from "@tetherbox/core";
import { startLlmForwarder } from "./llm-forwarder.ts";
import { loadProfileModules } from "./modules.ts";
import { formatTrigger, loadSystemPromptAppendix, readStarterConfig } from "./prompt.ts";
import { createBuiltinTools } from "./tools.ts";
import { createWebSearchExtension, resolveWebSearchMode } from "./web-search.ts";

const builtinSkillsDir = fileURLToPath(new URL("../skills", import.meta.url));
const PLACEHOLDER_OAUTH_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * A placeholder OAuth credential never expires, so Pi formats requests for the subscription API
 * and never tries to refresh. The daemon swaps in the real token.
 */
async function seedModelAuth(input: TurnInput, authPath: string): Promise<void> {
  if (input.modelAuth.kind !== "placeholder-oauth") {
    return;
  }

  const credential = {
    type: "oauth",
    access: input.modelAuth.access,
    refresh: "tetherbox",
    expires: Date.now() + PLACEHOLDER_OAUTH_LIFETIME_MS,
  };

  await writeFile(authPath, JSON.stringify({ [input.model.provider]: credential }), {
    mode: 0o600,
  });
}

export async function runTurn(input: TurnInput): Promise<TurnResult> {
  const { profileDir, socketPath, runToken } = input;
  const client = createInternalClient({ socketPath, runToken });
  const forwarder = await startLlmForwarder(socketPath);
  // TODO: Persist Pi sessions per profile (or per Slack thread) instead of a throwaway agent dir.
  const agentDir = await mkdtemp(join(tmpdir(), "tetherbox-run-"));

  try {
    const authPath = join(agentDir, "auth.json");

    await seedModelAuth(input, authPath);

    const modelRuntime = await ModelRuntime.create({
      authPath,
      modelsPath: join(agentDir, "models.json"),
    });
    const catalogModel = modelRuntime.getModel(input.model.provider, input.model.id);

    if (catalogModel === undefined) {
      throw new Error(`unknown model ${input.model.provider}/${input.model.id}`);
    }

    const webSearchMode = resolveWebSearchMode(input.model.provider, catalogModel.api);

    if (webSearchMode === undefined) {
      throw new Error(
        `model ${input.model.provider}/${input.model.id} (${catalogModel.api}) does not support built-in web search`,
      );
    }

    // TODO: Confirm every provider Pi supports honors a baseUrl override, and register custom
    // providers for BYO subscriptions that are not in Pi's catalog.
    const model = {
      ...catalogModel,
      baseUrl: forwarder.baseUrl(input.model.provider, catalogModel.baseUrl),
      headers: { ...catalogModel.headers, [RUN_TOKEN_HEADER]: runToken },
    };

    if (input.modelAuth.kind === "run-token-key") {
      await modelRuntime.setRuntimeApiKey(input.model.provider, runToken);
    }

    const settingsManager = SettingsManager.inMemory();

    // The daemon's LLM proxy relays HTTP only, so Pi must not open WebSocket streams.
    settingsManager.applyOverrides({ defaultTools: ["+codemode"], transport: "sse" });

    const starterConfig = await readStarterConfig(profileDir);
    const resourceLoader = new DefaultResourceLoader({
      cwd: profileDir,
      agentDir,
      settingsManager,
      extensionFactories: [
        createCodemodeExtension({ mode: "on" }),
        createWebSearchExtension(webSearchMode),
      ],
      additionalSkillPaths: [builtinSkillsDir, join(profileDir, profileLayout.skillsDir)],
      appendSystemPrompt: await loadSystemPromptAppendix(profileDir, starterConfig, input.threadTs),
    });

    await resourceLoader.reload();

    const fetchWithSecret = createSecretProxyFetch({ socketPath, runToken });
    const moduleTools = await loadProfileModules(
      profileDir,
      {
        profileId: input.profileId,
        fetchWithSecret,
        async hasSecret(secretKey) {
          const response = await client.rpc.secrets[":key"].$get({ param: { key: secretKey } });

          return response.ok && (await response.json()).exists;
        },
      },
      starterConfig,
    );
    const { session } = await createAgentSession({
      cwd: profileDir,
      agentDir,
      model,
      modelRuntime,
      settingsManager,
      resourceLoader,
      sessionManager: SessionManager.inMemory(profileDir),
      customTools: [...createBuiltinTools(client, fetchWithSecret), ...moduleTools],
    });

    try {
      await session.bindExtensions({});
      await session.prompt(formatTrigger(input.trigger));

      return { finalText: session.getLastAssistantText() ?? null };
    } finally {
      session.dispose();
    }
  } finally {
    await forwarder.close();
    await rm(agentDir, { recursive: true, force: true });
  }
}
