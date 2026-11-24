import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

const configSchema = z.object({
  sshAlias: z.string().min(1),
});
export type CliConfig = z.infer<typeof configSchema>;

const configPath = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "tetherbox",
  "config.json",
);

export async function readConfig(): Promise<CliConfig> {
  try {
    return configSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
  } catch {
    throw new Error(`No Tetherbox VM configured. Run "tetherbox setup" first.`);
  }
}

export async function writeConfig(config: CliConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}
