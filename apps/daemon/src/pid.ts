import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PID_FILE = "daemon.pid";

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export async function writePidFile(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await writeFile(join(dataDir, PID_FILE), `${process.pid}\n`, { mode: 0o600 });
}

export async function removePidFile(dataDir: string): Promise<void> {
  await rm(join(dataDir, PID_FILE), { force: true });
}

/**
 * Signals the live daemon to reload profiles and cron schedules. Returns false when no daemon is
 * running, so offline admin commands still succeed.
 */
export async function signalDaemonReload(dataDir: string): Promise<boolean> {
  let raw: string;

  try {
    raw = await readFile(join(dataDir, PID_FILE), "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }

    throw error;
  }

  const pid = Number.parseInt(raw.trim(), 10);

  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, "SIGHUP");

    return true;
  } catch (error) {
    if (hasErrorCode(error, "ESRCH")) {
      return false;
    }

    throw error;
  }
}
