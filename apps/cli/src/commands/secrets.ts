import * as p from "@clack/prompts";
import { secretKeySchema } from "@tetherbox/core";
import type { Command } from "commander";
import { readConfig } from "../config.ts";
import { runDaemonCommand } from "../remote.ts";

export function registerSecrets(program: Command): void {
  const secrets = program
    .command("secrets")
    .description("Manage secrets in the daemon's secret store");

  secrets
    .command("set")
    .description("Store a secret pinned to the domains it may be sent to")
    .argument("<key>", "secret name, such as LINEAR_API_KEY")
    .requiredOption("-d, --domain <domain...>", "domains the secret proxy may send this secret to")
    .option("-i, --inject <spec>", "bearer, header:<name>, or query:<name>", "bearer")
    .action(async (rawKey: string, options: { domain: string[]; inject: string }) => {
      const key = secretKeySchema.parse(rawKey);
      const { sshAlias } = await readConfig();
      const value = await p.password({ message: `Value for ${key}` });

      if (p.isCancel(value) || value === "") {
        p.cancel("No value entered.");

        return;
      }

      const domainArgs = options.domain.flatMap((domain) => ["--domain", domain]);

      process.exitCode = await runDaemonCommand(
        sshAlias,
        ["secrets", "set", key, ...domainArgs, "--inject", options.inject],
        { input: value },
      );
    });

  secrets
    .command("list")
    .description("List stored secret names")
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
