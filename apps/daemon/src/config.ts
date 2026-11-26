import { z } from "zod";

const envSchema = z.object({
  TETHERBOX_DATA_DIR: z.string().default("/var/lib/tetherbox"),
  TETHERBOX_PROFILES_DIR: z.string().default("/srv/tetherbox/profiles"),
  TETHERBOX_SESSIONS_DIR: z.string().default("/srv/tetherbox/sessions"),
  TETHERBOX_SOCKET: z.string().default("/run/tetherbox/internal.sock"),
  TETHERBOX_PUBLIC_HOST: z.string().default("127.0.0.1"),
  TETHERBOX_PUBLIC_PORT: z.coerce.number().int().positive().default(8787),
  TETHERBOX_AGENT_USER: z.string().min(1).optional(),
  TETHERBOX_AGENT_ENTRY: z.string().default("/opt/tetherbox/apps/agent/dist/main.mjs"),
  TETHERBOX_TURN_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(900),
});

export interface DaemonConfig {
  dataDir: string;
  profilesDir: string;
  sessionsDir: string;
  socketPath: string;
  publicHost: string;
  publicPort: number;
  agent: { user: string | undefined; entry: string; timeoutMs: number };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): DaemonConfig {
  const parsed = envSchema.parse(env);

  return {
    dataDir: parsed.TETHERBOX_DATA_DIR,
    profilesDir: parsed.TETHERBOX_PROFILES_DIR,
    sessionsDir: parsed.TETHERBOX_SESSIONS_DIR,
    socketPath: parsed.TETHERBOX_SOCKET,
    publicHost: parsed.TETHERBOX_PUBLIC_HOST,
    publicPort: parsed.TETHERBOX_PUBLIC_PORT,
    agent: {
      user: parsed.TETHERBOX_AGENT_USER,
      entry: parsed.TETHERBOX_AGENT_ENTRY,
      timeoutMs: parsed.TETHERBOX_TURN_TIMEOUT_SECONDS * 1000,
    },
  };
}
