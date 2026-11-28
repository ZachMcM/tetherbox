import { RpcError } from "../errors.ts";

function lastHeaderEntry(header: string | null | undefined): string | undefined {
  if (header === null || header === undefined) {
    return undefined;
  }

  const entry = header.split(",").at(-1)?.trim();

  return entry === "" ? undefined : entry;
}

export function parseForwardedProto(
  header: string | null | undefined,
): "http" | "https" | undefined {
  const value = lastHeaderEntry(header)?.toLowerCase();

  return value === "http" || value === "https" ? value : undefined;
}

function parseValidHost(raw: string | undefined): string | undefined {
  if (raw === undefined || /[/?#@\\\s]/.test(raw)) {
    return undefined;
  }

  const parsed = URL.parse(`http://${raw}`);

  if (parsed === null || parsed.hostname === "" || parsed.pathname !== "/") {
    return undefined;
  }

  return parsed.host;
}

export function requestOrigin(url: string, headers: Headers): string {
  const parsed = new URL(url);
  const rawForwardedProto = headers.get("x-forwarded-proto");
  const forwardedProto = parseForwardedProto(rawForwardedProto);

  if (rawForwardedProto !== null && forwardedProto === undefined) {
    throw new RpcError(400, "invalid x-forwarded-proto header");
  }

  const rawForwardedHost = headers.get("x-forwarded-host");
  const forwardedHost = parseValidHost(lastHeaderEntry(rawForwardedHost));

  if (rawForwardedHost !== null && forwardedHost === undefined) {
    throw new RpcError(400, "invalid x-forwarded-host header");
  }

  const requestProto = parsed.protocol === "https:" ? "https" : "http";
  const proto = forwardedProto ?? requestProto;
  const host = forwardedHost ?? parseValidHost(headers.get("host") ?? undefined) ?? parsed.host;

  return `${proto}://${host}`;
}
