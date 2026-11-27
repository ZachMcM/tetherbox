import type { ModelEffort, ModelRef } from "@tetherbox/core/app";

const EFFORT_ORDER: readonly ModelEffort[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export const PI_DEFAULT_EFFORT: ModelEffort = "medium";

export function modelRefsEqual(a: ModelRef, b: ModelRef): boolean {
  return a.provider === b.provider && a.auth === b.auth && a.id === b.id;
}

export function nearestEffort(
  levels: readonly ModelEffort[],
  wanted: ModelEffort,
): ModelEffort | undefined {
  if (levels.includes(wanted)) {
    return wanted;
  }

  const wantedIndex = EFFORT_ORDER.indexOf(wanted);
  const above = EFFORT_ORDER.slice(wantedIndex + 1).find((level) => levels.includes(level));

  return above ?? EFFORT_ORDER.slice(0, wantedIndex).findLast((level) => levels.includes(level));
}
