import { type StarterSummary } from "@tetherbox/core/app";
import { Badge } from "@tetherbox/ui/components/badge";
import { starterKindLabel } from "../../lib/starter-readiness.ts";

export function StarterBadges({ starter }: { starter: StarterSummary }) {
  return (
    <>
      <Badge variant="attribute">{starterKindLabel(starter)}</Badge>
      {starter.source === "library" && <Badge variant="attribute">Library</Badge>}
    </>
  );
}
