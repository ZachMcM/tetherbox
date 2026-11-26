export const RUN_TOKEN_HEADER = "x-tetherbox-run-token";
export const SECRET_KEY_HEADER = "x-tetherbox-secret";

export function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }

  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());

  return match?.[1];
}
