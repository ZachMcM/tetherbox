import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMissing } from "../../file-store.ts";

export const APP_SESSION_COOKIE = "tetherbox_session";

export function loadOrCreateAppToken(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  const path = join(dataDir, "app-token");

  try {
    const existing = readFileSync(path, "utf8").trim();

    if (existing.length >= 32) {
      return existing;
    }
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }

  const token = randomBytes(32).toString("base64url");

  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);

  return token;
}

export function verifyAppToken(expected: string, candidate: string | undefined): boolean {
  if (candidate === undefined || candidate === "") {
    return false;
  }

  const expectedBuf = Buffer.from(expected, "utf8");
  const candidateBuf = Buffer.from(candidate, "utf8");

  return expectedBuf.length === candidateBuf.length && timingSafeEqual(expectedBuf, candidateBuf);
}
