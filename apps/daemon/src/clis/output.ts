import type { CliAuthFlowEvent } from "@tetherbox/core";

const MAX_OUTPUT_CHARS = 32_000;

const ANSI_PATTERN = new RegExp(
  `${String.fromCharCode(0x1b)}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${String.fromCharCode(0x07)}${String.fromCharCode(0x1b)}]*(?:${String.fromCharCode(0x07)}|${String.fromCharCode(0x1b)}\\\\)|[@-Z\\\\-_])`,
  "g",
);

const URL_PATTERN = /https:\/\/[^\s"'<>)\]]+/g;
const DEVICE_CODE_PATTERN =
  /(?:one-time\s+code|enter\s+(?:the\s+)?code|user\s+code)[^\nA-Z0-9]*([A-Z0-9]{4}-[A-Z0-9]{4})/i;
const PROMPT_LINE_PATTERN =
  /(?:paste|enter|code|token|url|password|passphrase|confirm|\(y\/n\)|\[y\/n\])[^\n]*[:?]\s*$/i;

function stripAnsi(raw: string): string {
  return raw.replaceAll(ANSI_PATTERN, "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

export function appendOutput(current: string, chunk: string): string {
  const combined = current + stripAnsi(chunk);

  return combined.length <= MAX_OUTPUT_CHARS ? combined : combined.slice(-MAX_OUTPUT_CHARS);
}

function cleanUrl(raw: string): string {
  return raw.replace(/[.,;:!?]+$/, "");
}

export function extractAuthEvents(output: string): CliAuthFlowEvent[] {
  const urls: string[] = [];
  const seenUrls = new Set<string>();

  for (const match of output.matchAll(URL_PATTERN)) {
    const url = cleanUrl(match[0]);

    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      urls.push(url);
    }
  }

  const events: CliAuthFlowEvent[] = [];
  const codeMatch = DEVICE_CODE_PATTERN.exec(output);

  if (codeMatch?.[1] !== undefined) {
    const verificationUri =
      urls.find((url) => /device|activate|verify|login/i.test(url)) ?? urls[0];

    if (verificationUri !== undefined) {
      events.push({
        kind: "device_code",
        verificationUri,
        userCode: codeMatch[1].toUpperCase(),
      });
    }
  }

  for (const url of urls) {
    events.push({ kind: "auth_url", url });
  }

  return events;
}

export function detectPromptLine(output: string): string | null {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const last = lines.at(-1);

  if (last === undefined) {
    return null;
  }

  return PROMPT_LINE_PATTERN.test(last) ? last : null;
}
