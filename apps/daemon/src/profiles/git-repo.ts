import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function git(dir: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], { cwd: dir });

  return stdout;
}

export async function initRepo(dir: string): Promise<void> {
  if (existsSync(join(dir, ".git"))) {
    return;
  }

  await git(dir, ["init", "-q"]);
  await git(dir, ["config", "user.name", "Tetherbox"]);
  await git(dir, ["config", "user.email", "tetherbox@localhost"]);
  await git(dir, ["config", "commit.gpgsign", "false"]);
}

export async function commitFile({
  dir,
  file,
  message,
}: {
  dir: string;
  file: string;
  message: string;
}): Promise<void> {
  if (!existsSync(join(dir, ".git"))) {
    return;
  }

  await git(dir, ["add", "--", file]);

  if ((await git(dir, ["diff", "--cached", "--name-only", "--", file])).trim() !== "") {
    await git(dir, ["commit", "-q", "--no-verify", "--no-gpg-sign", "-m", message, "--", file]);
  }
}

export async function commitAll(dir: string, message: string): Promise<void> {
  await git(dir, ["add", "-A"]);

  if ((await git(dir, ["status", "--porcelain"])).trim() !== "") {
    await git(dir, ["commit", "-q", "--no-verify", "--no-gpg-sign", "-m", message]);
  }
}
