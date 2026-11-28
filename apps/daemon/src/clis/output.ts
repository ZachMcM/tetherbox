import type { CliAuthFlowEvent } from "@tetherbox/core";

const MAX_OUTPUT_CHARS = 32_000;

const ANSI_PATTERN = new RegExp(
  `${String.fromCharCode(0x1b)}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${String.fromCharCode(0x07)}${String.fromCharCode(0x1b)}]*(?:${String.fromCharCode(0x07)}|${String.fromCharCode(0x1b)}\\\\)|[@-Z\\\\-_78])`,
  "g",
);

const URL_PATTERN = /https:\/\/[^\s"'<>)\]]+/g;
const DEVICE_CODE_PATTERN =
  /(?:one-time\s+code|enter\s+(?:the\s+)?code|user\s+code)[^\nA-Z0-9]*([A-Z0-9]{4}-[A-Z0-9]{4})/i;
const PROMPT_LINE_PATTERN =
  /(?:(?:paste|enter|code|token|url|password|passphrase|confirm)[^\n]*[:?]|(?:\(y\/n\)|\[y\/n\])[:?]?)\s*$/i;
const INFO_LINK_PREFIX_PATTERN = /(?:read|learn)\s+more(?:\s+at)?[\s:]*$/i;
const IGNORED_INFO_HOST_PATTERN = /^(?:docs|blog|help|support)\./;
const IGNORED_INFO_PATH_PATTERN = /^\/(?:changelog|blog|docs|help|releases)(?:\/|$)/;

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

function isIgnoredInfoUrl(rawUrl: string, output: string, index: number): boolean {
  const prefix = output.slice(Math.max(0, index - 40), index);

  if (INFO_LINK_PREFIX_PATTERN.test(prefix)) {
    return true;
  }

  const parsed = URL.parse(rawUrl);

  if (parsed === null) {
    return true;
  }

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();

  return (
    host === "gh.io" ||
    host.endsWith(".blog") ||
    IGNORED_INFO_HOST_PATTERN.test(host) ||
    IGNORED_INFO_PATH_PATTERN.test(path)
  );
}

export function extractAuthEvents(output: string): CliAuthFlowEvent[] {
  const urls: string[] = [];
  const seenUrls = new Set<string>();

  for (const match of output.matchAll(URL_PATTERN)) {
    const url = cleanUrl(match[0]);

    if (isIgnoredInfoUrl(url, output, match.index)) {
      continue;
    }

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
