import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

async function download(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status} for ${url}`);
  }

  return response;
}

const arch = process.arch === "x64" ? "amd64" : process.arch;
const filename = `rex-linux-${arch}.tar.gz`;

if (process.platform !== "linux") {
  throw new Error("This Rex installer requires Linux");
}

const release = await download("https://blob.superlogical.com/api/releases/rex/preview");
const { artifacts } = await release.json();
const artifact = artifacts.find((entry) => entry.filename === filename);

if (!artifact) {
  throw new Error(`Rex release is missing ${filename}`);
}

const response = await download(artifact.downloadUrl);
const archive = Buffer.from(await response.arrayBuffer());

if (createHash("sha256").update(archive).digest("hex") !== artifact.sha256) {
  throw new Error(`Checksum mismatch for ${filename}`);
}

const bin = join(homedir(), ".local", "bin");

await mkdir(bin, { recursive: true });
const tmp = await mkdtemp(join(bin, ".rex-"));

try {
  execFileSync("tar", ["-xzf", "-", "rex"], { cwd: tmp, input: archive });
  const binary = join(tmp, "rex");

  await chmod(binary, 0o755);
  execFileSync(binary, ["version"], { stdio: "inherit" });
  await rename(binary, join(bin, "rex"));
} finally {
  await rm(tmp, { recursive: true, force: true });
}
