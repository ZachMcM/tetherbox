import { type StarterSummary } from "@tetherbox/core/app";
import { Badge } from "@tetherbox/ui/components/badge";
import { starterKindLabel } from "../../lib/starter-readiness.ts";

export function StarterBadges({ starter }: { starter: StarterSummary }) {
  return (
    <>
      <Badge variant="outline" className="shrink-0 px-1.5 text-[10px]">
        {starterKindLabel(starter)}
      </Badge>
      {starter.source === "library" && (
        <Badge variant="secondary" className="shrink-0 px-1.5 text-[10px]">
          Library
        </Badge>
      )}
    </>
  );
}
