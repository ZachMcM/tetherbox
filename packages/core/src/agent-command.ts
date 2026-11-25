export const AGENT_SYSTEM_PATH = "/usr/local/bin:/usr/bin:/bin";

const AGENT_PATH_WRAPPER = `export PATH="$HOME/.local/bin:${AGENT_SYSTEM_PATH}"; exec "$@"`;

export interface AgentSudoCommandOptions {
  readonly user: string;
  readonly command: readonly string[];
  readonly nonInteractive?: boolean;
}

export function localAgentPath(home: string | undefined): string {
  return home === undefined || home === ""
    ? AGENT_SYSTEM_PATH
    : `${home}/.local/bin:${AGENT_SYSTEM_PATH}`;
}

export function buildAgentSudoCommand({
  user,
  command,
  nonInteractive = true,
}: AgentSudoCommandOptions): readonly [string, string[]] {
  return [
    "sudo",
    [
      ...(nonInteractive ? ["-n"] : []),
      "-H",
      "-u",
      user,
      "--",
      "sh",
      "-c",
      AGENT_PATH_WRAPPER,
      "_",
      ...command,
    ],
  ];
}
