import type { z } from "zod";

export function parseJsonColumn<T>({
  column,
  schema,
  raw,
  fallback,
}: {
  column: string;
  schema: z.ZodType<T>;
  raw: string | null | undefined;
  fallback: T;
}): T {
  if (raw === null || raw === undefined) {
    return fallback;
  }

  try {
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    console.error(`ignoring unreadable stored ${column}`, error);

    return fallback;
  }
}
