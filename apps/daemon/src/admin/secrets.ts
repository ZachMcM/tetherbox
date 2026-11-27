import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";
import {
  formatSecretInjection,
  resolveSecretBinding,
  secretKeySchema,
  type SecretBinding,
} from "@tetherbox/core";
import type { SecretStore } from "../credentials/secret-store.ts";

function formatBinding(binding: SecretBinding): string {
  switch (binding.kind) {
    case "daemon":
      return "daemon";
    case "llm":
      return `llm\t${binding.provider}`;
    case "proxy":
      return `proxy\t${binding.domains.join(",")}\t${formatSecretInjection(binding.inject)}`;
    default: {
      const exhaustive: never = binding;

      return exhaustive;
    }
  }
}

/**
 * Commands run on the VM as the daemon's OS user, usually through `tetherbox` over SSH. Secret
 * values arrive on stdin so they never show up in process arguments or shell history.
 */
export async function runSecretsCommand(store: SecretStore, args: string[]): Promise<void> {
  const [action, rawKey, ...rest] = args;

  switch (action) {
    case "set": {
      const { values } = parseArgs({
        args: rest,
        options: {
          domain: { type: "string", multiple: true, default: [] },
          inject: { type: "string" },
          provider: { type: "string" },
        },
      });
      const key = secretKeySchema.parse(rawKey);
      const binding = resolveSecretBinding({
        domains: values.domain,
        inject: values.inject,
        provider: values.provider,
      });
      const value = (await text(process.stdin)).trim();

      if (value === "") {
        throw new Error("expected the secret value on stdin");
      }

      await store.set(key, { value, binding });
      console.log(`stored ${key} (${binding.kind})`);

      return;
    }
    case "has":
      console.log((await store.has(secretKeySchema.parse(rawKey))) ? "yes" : "no");

      return;
    case "delete":
      await store.delete(secretKeySchema.parse(rawKey));

      return;
    case "list": {
      const { values } = parseArgs({
        args: args.slice(1),
        options: { json: { type: "boolean", default: false } },
      });
      const entries = await store.list();

      if (values.json) {
        console.log(JSON.stringify(entries));

        return;
      }

      for (const entry of entries) {
        console.log(`${entry.key}\t${formatBinding(entry.binding)}`);
      }

      return;
    }
    default:
      throw new Error("usage: tetherbox-daemon secrets <set|has|delete|list> [key]");
  }
}
