import { mkdtemp, rm } from "node:fs/promises";
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
  type TurnInput,
  type TurnResult,
} from "@tetherbox/core";
import { startLlmForwarder } from "./llm-forwarder.ts";
import { loadProfileModules } from "./modules.ts";
import { formatTrigger, loadSystemPromptAppendix } from "./prompt.ts";
import { createBuiltinTools } from "./tools.ts";

const builtinSkillsDir = fileURLToPath(new URL("../skills", import.meta.url));

export async function runTurn(input: TurnInput): Promise<TurnResult> {
  const { profileDir, socketPath, runToken } = input;
  const client = createInternalClient({ socketPath, runToken });
  const forwarder = await startLlmForwarder(socketPath);
  // TODO: Persist Pi sessions per profile (or per Slack thread) instead of a throwaway agent dir.
  const agentDir = await mkdtemp(join(tmpdir(), "tetherbox-run-"));

  try {
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: join(agentDir, "models.json"),
    });
    const catalogModel = modelRuntime.getModel(input.model.provider, input.model.id);

    if (catalogModel === undefined) {
      throw new Error(`unknown model ${input.model.provider}/${input.model.id}`);
    }

    // TODO: Confirm every provider Pi supports honors a baseUrl override, and register custom
    // providers for BYO subscriptions that are not in Pi's catalog.
    const model = {
      ...catalogModel,
      baseUrl: forwarder.baseUrl(input.model.provider, catalogModel.baseUrl),
    };

    await modelRuntime.setRuntimeApiKey(input.model.provider, runToken);

    const settingsManager = SettingsManager.inMemory();

    settingsManager.applyOverrides({ defaultTools: ["+codemode"] });

    const resourceLoader = new DefaultResourceLoader({
      cwd: profileDir,
      agentDir,
      settingsManager,
      extensionFactories: [createCodemodeExtension({ mode: "on" })],
      additionalSkillPaths: [builtinSkillsDir, join(profileDir, profileLayout.skillsDir)],
      appendSystemPrompt: await loadSystemPromptAppendix(profileDir),
    });

    await resourceLoader.reload();

    const fetchWithSecret = createSecretProxyFetch({ socketPath, runToken });
    const moduleTools = await loadProfileModules(profileDir, {
      profileId: input.profileId,
      fetchWithSecret,
      async hasSecret(secretKey) {
        const response = await client.rpc.secrets[":key"].$get({ param: { key: secretKey } });

        return response.ok && (await response.json()).exists;
      },
    });
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
