import { hostnameSchema } from "@tetherbox/core/app";

export function splitList(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map((item) => item.trim())
        .filter((item) => item !== ""),
    ),
  ];
}

export function parseDomainsList(
  raw: string,
): { ok: true; domains: [string, ...string[]] } | { ok: false; error: string } {
  const [first, ...rest] = splitList(raw.toLowerCase());

  if (first === undefined) {
    return { ok: false, error: "Enter at least one hostname (for example api.linear.app)" };
  }

  for (const host of [first, ...rest]) {
    if (!hostnameSchema.safeParse(host).success) {
      return { ok: false, error: `"${host}" is not a valid hostname (omit https:// and paths)` };
    }
  }

  return { ok: true, domains: [first, ...rest] };
}
