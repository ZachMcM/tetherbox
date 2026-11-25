import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_FETCH_CHARS = 32 * 1024;
const USER_AGENT = "Tetherbox/1.0";

export interface WebFetchInput {
  readonly url: string;
  readonly timeoutMs?: number;
}

export interface WebFetchResult {
  readonly url: string;
  readonly status: number;
  readonly contentType: string;
  readonly title?: string;
  readonly body: string;
  readonly truncated?: true;
}

function validateUrl(rawUrl: string): URL {
  const parsed = URL.parse(rawUrl.trim());

  if (parsed === null || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    throw new Error(`Expected an http or https URL, got "${rawUrl}"`);
  }

  return parsed;
}

function isHtml(contentType: string): boolean {
  const lower = contentType.toLowerCase();

  return lower.includes("text/html") || lower.includes("application/xhtml+xml");
}

function isPlainText(contentType: string): boolean {
  const lower = contentType.toLowerCase();

  return (
    lower === "" ||
    lower.startsWith("text/") ||
    lower.includes("application/json") ||
    lower.includes("+json") ||
    lower.includes("application/xml") ||
    lower.includes("+xml")
  );
}

function htmlToMarkdown(html: string): { title?: string; markdown: string } {
  const { document } = parseHTML(html);
  const article = new Readability(document).parse();
  const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

  turndown.remove(["script", "style", "noscript"]);

  if (article?.content) {
    const markdown = turndown.turndown(article.content).trim();
    const title = article.title?.trim();

    if (markdown !== "") {
      return {
        ...(title ? { title } : {}),
        markdown: title ? `# ${title}\n\n${markdown}` : markdown,
      };
    }
  }

  const fallbackHtml = document.body?.innerHTML ?? html;
  const fallbackMarkdown = turndown.turndown(fallbackHtml).trim();
  const fallbackTitle = document.title?.trim();

  return {
    ...(fallbackTitle ? { title: fallbackTitle } : {}),
    markdown: fallbackMarkdown,
  };
}

export async function fetchWebPage(input: WebFetchInput): Promise<WebFetchResult> {
  const target = validateUrl(input.url);
  const timeoutMs = Math.min(
    Math.max(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000),
    MAX_TIMEOUT_MS,
  );

  const response = await fetch(target, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/markdown, text/html;q=0.9, text/plain;q=0.8, application/json;q=0.8, */*;q=0.5",
    },
  });

  const contentType = response.headers.get("content-type") ?? "";

  if (!isHtml(contentType) && !isPlainText(contentType)) {
    await response.body?.cancel();
    throw new Error(`Unsupported content-type "${contentType}" from ${response.url}`);
  }

  const rawBody = await response.text();
  let title: string | undefined;
  let content = rawBody;

  if (isHtml(contentType)) {
    const extracted = htmlToMarkdown(rawBody);

    title = extracted.title;
    content = extracted.markdown;
  }

  const truncated = content.length > MAX_FETCH_CHARS;
  const body = truncated ? content.slice(0, MAX_FETCH_CHARS) : content;

  return {
    url: response.url,
    status: response.status,
    contentType,
    ...(title !== undefined ? { title } : {}),
    body,
    ...(truncated ? { truncated: true } : {}),
  };
}
