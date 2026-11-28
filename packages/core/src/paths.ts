export const profileLayout = {
  config: "profile.json",
  memory: "MEMORY.md",
  memoryDir: "memory",
  skillsDir: "skills",
  modulesDir: "modules",
  moduleEntry: "index.ts",
  starterManifest: "starter.json",
  cronDir: "cron",
  webhooksDir: "webhooks",
} as const;

export function webhookPath<P extends string, N extends string>(
  profileId: P,
  name: N,
): `/hooks/${P}/${N}` {
  return `/hooks/${profileId}/${name}`;
}
