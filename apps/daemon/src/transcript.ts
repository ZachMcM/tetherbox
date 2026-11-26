import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  transcriptEntrySchema,
  type ProfileId,
  type SessionId,
  type TranscriptEntry,
} from "@tetherbox/core";
import { isMissing } from "./file-store.ts";

export function sessionTranscriptPath(
  sessionsDir: string,
  profileId: ProfileId,
  sessionId: SessionId,
): string {
  return join(sessionsDir, profileId, `${sessionId}.jsonl`);
}

export async function readSessionTranscript(
  sessionsDir: string,
  profileId: ProfileId,
  sessionId: SessionId,
): Promise<TranscriptEntry[]> {
  let raw: string;

  try {
    raw = await readFile(sessionTranscriptPath(sessionsDir, profileId, sessionId), "utf8");
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }

    throw error;
  }

  const entries: TranscriptEntry[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();

    if (trimmed === "") {
      continue;
    }

    try {
      const parsed = transcriptEntrySchema.safeParse(JSON.parse(trimmed));

      if (parsed.success) {
        entries.push(parsed.data);
      }
    } catch {
      // Skip partial or malformed trailing lines while a run is mid-write.
    }
  }

  return entries;
}

export async function removeSessionTranscript(
  sessionsDir: string,
  profileId: ProfileId,
  sessionId: SessionId,
): Promise<void> {
  await rm(sessionTranscriptPath(sessionsDir, profileId, sessionId), { force: true });
}
