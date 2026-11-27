import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { WebSearchMode } from "@tetherbox/core";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function appendUnique(
  existing: unknown,
  entry: Record<string, unknown>,
  matches: (item: Record<string, unknown>) => boolean,
): unknown[] {
  const list = Array.isArray(existing) ? existing : [];
  const alreadyPresent = list.some((item) => isRecord(item) && matches(item));

  return alreadyPresent ? list : [...list, entry];
}

function injectNativeWebSearch(
  payload: Record<string, unknown>,
  mode: WebSearchMode,
): Record<string, unknown> {
  switch (mode) {
    case "openrouter":
      return {
        ...payload,
        plugins: appendUnique(payload.plugins, { id: "web" }, (item) => item.id === "web"),
      };
    case "openai-responses":
      return {
        ...payload,
        tools: appendUnique(
          payload.tools,
          { type: "web_search" },
          (item) => item.type === "web_search" || item.type === "web_search_preview",
        ),
      };
    case "anthropic-messages":
      return {
        ...payload,
        tools: appendUnique(
          payload.tools,
          { type: "web_search_20250305", name: "web_search" },
          (item) => typeof item.type === "string" && item.type.startsWith("web_search_"),
        ),
      };
    case "google-generative-ai": {
      const config = isRecord(payload.config) ? payload.config : {};

      return {
        ...payload,
        config: {
          ...config,
          tools: appendUnique(config.tools, { googleSearch: {} }, (item) => "googleSearch" in item),
        },
      };
    }
    default: {
      const exhaustive: never = mode;

      return exhaustive;
    }
  }
}

export function createWebSearchExtension(mode: WebSearchMode): ExtensionFactory {
  return (pi) => {
    pi.on("before_provider_request", (event) => {
      if (!isRecord(event.payload)) {
        return undefined;
      }

      return injectNativeWebSearch(event.payload, mode);
    });
  };
}
