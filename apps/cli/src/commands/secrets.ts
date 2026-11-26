import * as p from "@clack/prompts";
import { resolveSecretBinding, secretKeySchema } from "@tetherbox/core";
import type { Command } from "commander";
import { readConfig } from "../config.ts";
import { runDaemonCommand } from "../remote.ts";
import { promptAndSetSecret } from "../secrets.ts";

export function registerSecrets(program: Command): void {
  const secrets = program
    .command("secrets")
    .description("Manage secrets in the daemon's secret store");

  secrets
    .command("set")
    .description("Store a daemon-only secret, domain-pinned proxy secret, or LLM provider key")
    .argument("<key>", "secret name, such as LINEAR_API_KEY or GITHUB_WEBHOOK_SECRET")
    .option("-d, --domain <domain...>", "domains the secret proxy may send this secret to")
    .option("-i, --inject <spec>", "bearer, header:<name>, or query:<name> (requires --domain)")
    .option("-p, --provider <provider>", "LLM provider name for /llm proxy credentials")
    .action(
      async (
        rawKey: string,
        options: { domain?: string[]; inject?: string; provider?: string },
      ) => {
        const key = secretKeySchema.parse(rawKey);
        const binding = resolveSecretBinding({
          domains: options.domain,
          inject: options.inject,
          provider: options.provider,
        });
        const { sshAlias } = await readConfig();
        const status = await promptAndSetSecret({ sshAlias, key, binding });

        if (status === "cancelled") {
          p.cancel("No value entered.");
        }
      },
    );

  secrets
    .command("list")
    .description("List stored secrets and their bindings")
    .action(async () => {
      const { sshAlias } = await readConfig();

      process.exitCode = await runDaemonCommand(sshAlias, ["secrets", "list"]);
    });

  secrets
    .command("delete")
    .description("Delete a stored secret")
    .argument("<key>", "secret name")
    .action(async (rawKey: string) => {
      const { sshAlias } = await readConfig();

      process.exitCode = await runDaemonCommand(sshAlias, [
        "secrets",
        "delete",
        secretKeySchema.parse(rawKey),
      ]);
    });
}
