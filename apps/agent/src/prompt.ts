import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  profileConfigSchema,
  profileLayout,
  type StarterConfig,
  type TurnTrigger,
} from "@tetherbox/core";

const MEMORY_PROMPT_BYTES = 8 * 1024;

const RUNTIME_PROMPT = `You are Tetherbox, a personal assistant for an engineer, running inside one profile.
Reply to the user with the send_message tool. Your profile directory is your working directory.
${profileLayout.memory} is your memory index: a few always-relevant facts plus one line per file or
folder in ${profileLayout.memoryDir}/. Read those files when they are relevant, and follow the memory skill when you change them.
skills/ and modules/ hold what this profile can do.
Never ask for API keys, tokens, or passwords in chat. Direct the user to \`tetherbox secrets set\` for daemon-managed secrets and \`tetherbox auth\` for external CLI logins.`;

async function readMemory(profileDir: string): Promise<string | undefined> {
  try {
    return await readFile(join(profileDir, profileLayout.memory), "utf8");
  } catch {
    return undefined;
  }
}

function capMemory(memory: string): string {
  const bytes = Buffer.from(memory, "utf8");

  if (bytes.length <= MEMORY_PROMPT_BYTES) {
    return memory;
  }

  const kept = bytes.subarray(0, MEMORY_PROMPT_BYTES).toString("utf8");

  return `${kept}\n\n[${profileLayout.memory} is ${bytes.length} bytes and was cut at ${MEMORY_PROMPT_BYTES}. Consolidate it: move details into ${profileLayout.memoryDir}/ and keep one index line per topic.]`;
}

export async function readStarterConfig(profileDir: string): Promise<StarterConfig> {
  try {
    const raw = await readFile(join(profileDir, profileLayout.config), "utf8");

    return profileConfigSchema.parse(JSON.parse(raw)).starterConfig;
  } catch {
    return {};
  }
}

function formatStarterConfig(starterConfig: StarterConfig): string | undefined {
  const entries = Object.entries(starterConfig).filter(
    ([, fields]) => Object.keys(fields).length > 0,
  );

  if (entries.length === 0) {
    return undefined;
  }

  const lines = entries.flatMap(([starterId, fields]) =>
    Object.entries(fields).map(([key, value]) => `- ${starterId}.${key}: ${value}`),
  );

  return `# Starter config (${profileLayout.config})\n\n${lines.join("\n")}`;
}

export async function loadSystemPromptAppendix(
  profileDir: string,
  starterConfig: StarterConfig,
  threadTs?: string,
): Promise<string[]> {
  const sections = [RUNTIME_PROMPT];

  if (threadTs !== undefined) {
    sections.push(`# Active Slack thread\n\n- threadTs: ${threadTs}`);
  }

  const starterConfigSection = formatStarterConfig(starterConfig);

  if (starterConfigSection !== undefined) {
    sections.push(starterConfigSection);
  }

  const memory = await readMemory(profileDir);

  if (memory !== undefined) {
    sections.push(`# Memory (${profileLayout.memory})\n\n${capMemory(memory)}`);
  }

  return sections;
}

export function formatTrigger(trigger: TurnTrigger): string {
  switch (trigger.kind) {
    case "slack":
      return trigger.text;
    case "cron":
      return `Scheduled job "${trigger.job}" fired.\n\n${trigger.prompt}`;
    case "webhook":
      return `Webhook "${trigger.hook}" received a payload.\n\n${trigger.prompt}\n\n\`\`\`json\n${JSON.stringify(trigger.payload, null, 2)}\n\`\`\``;
    case "poll":
      return `Poll job "${trigger.job}" is ${trigger.status}.\n\n${trigger.prompt}\n\n${trigger.output}`;
    case "reminder":
      return `Reminder "${trigger.name}" fired.\n\n${trigger.prompt}`;
  }
}
