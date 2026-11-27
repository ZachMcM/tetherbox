import { useId } from "react";
import type { LlmProvider, StarterCategory, StarterSummary } from "@tetherbox/core/app";
import { BotIcon, PlugIcon, TerminalIcon, type LucideIcon } from "lucide-react";
import { cn } from "@tetherbox/ui/lib/utils";
import { ProviderIcon } from "./provider-icons.tsx";
import { STARTER_ICON_SVGS } from "./starter-icon-svgs.ts";

const PROVIDER_ICON_STARTERS: Readonly<Record<string, LlmProvider>> = {
  claude: "anthropic",
  opencode: "opencode",
};

const CATEGORY_FALLBACK_ICONS: Readonly<Record<StarterCategory, LucideIcon>> = {
  cli: TerminalIcon,
  harness: BotIcon,
  integration: PlugIcon,
};

function scopeSvgIds(body: string, prefix: string): string {
  let scoped = body;

  for (const [, id] of body.matchAll(/\bid="([^"]+)"/g)) {
    if (id !== undefined) {
      scoped = scoped
        .replaceAll(`id="${id}"`, `id="${prefix}-${id}"`)
        .replaceAll(`url(#${id})`, `url(#${prefix}-${id})`)
        .replaceAll(`href="#${id}"`, `href="#${prefix}-${id}"`);
    }
  }

  return scoped;
}

export function StarterIcon({
  starter,
  className,
}: {
  starter: Pick<StarterSummary, "id" | "category">;
  className?: string | undefined;
}) {
  const idPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const classes = cn("size-4 shrink-0", className);
  const svg = STARTER_ICON_SVGS[starter.id];

  if (svg !== undefined) {
    return (
      <svg
        viewBox={svg.viewBox}
        aria-hidden="true"
        className={classes}
        dangerouslySetInnerHTML={{ __html: scopeSvgIds(svg.body, idPrefix) }}
      />
    );
  }

  const provider = PROVIDER_ICON_STARTERS[starter.id];

  if (provider !== undefined) {
    return <ProviderIcon provider={provider} className={classes} />;
  }

  const FallbackIcon = CATEGORY_FALLBACK_ICONS[starter.category];

  return <FallbackIcon aria-hidden="true" className={cn(classes, "text-muted-foreground")} />;
}
