import type { StarterHandlers } from "@tetherbox/core";
import type { StarterCatalog } from "../../../profiles/starter-catalog.ts";

export function createStarterHandlers({ catalog }: { catalog: StarterCatalog }): StarterHandlers {
  return {
    list: () => catalog.summaries(),
    removeFromLibrary: (starterId) => catalog.remove(starterId),
  };
}
