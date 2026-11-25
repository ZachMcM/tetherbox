import * as p from "@clack/prompts";
import { llmProviderSchema, profileConfigSchema, profileIdSchema } from "@tetherbox/core";
import { collectStarterSecrets, starters } from "@tetherbox/starters";
import type { Command } from "commander";
import pc from "picocolors";
import { readConfig } from "../config.ts";
import { runDaemonCommand } from "../remote.ts";
import { ensureLlmProviderSecret, ensureRequiredSecrets, listRemoteSecrets } from "../secrets.ts";

const slackChannelSchema = profileConfigSchema.shape.slackChannelId;

export function registerProfiles(program: Command): void {
  const profiles = program.command("profiles").description("Manage Tetherbox profiles on the VM");

  profiles
    .command("list")
    .description("List profiles and the Slack channels they map to")
    .action(async () => {
      const { sshAlias } = await readConfig();

      process.exitCode = await runDaemonCommand(sshAlias, ["profiles", "list"]);
    });

  profiles
    .command("validate")
    .description("Check a profile's config, cron, webhook, and poll files")
    .argument("<id>", "profile id")
    .action(async (id: string) => {
      const { sshAlias } = await readConfig();

      process.exitCode = await runDaemonCommand(sshAlias, ["profiles", "validate", id]);
    });

  profiles
    .command("reload")
    .description("Reload profiles and cron schedules in the running daemon")
    .action(async () => {
      const { sshAlias } = await readConfig();

      process.exitCode = await runDaemonCommand(sshAlias, ["profiles", "reload"]);
    });

  profiles
    .command("create")
    .description("Create a profile for a Slack channel or DM")
    .argument("<id>", "profile id")
    .action(async (rawId: string) => {
      const id = profileIdSchema.parse(rawId);
      const { sshAlias } = await readConfig();

      p.intro(pc.bold(`tetherbox profiles create ${id}`));

      const name = await p.text({
        message: "Profile name",
        placeholder: id,
        defaultValue: id,
        validate: (value) => (value?.trim() ? undefined : "A profile name is required"),
      });

      if (p.isCancel(name)) {
        p.cancel("Profile creation cancelled.");

        return;
      }

      const channel = await p.text({
        message: "Slack channel or DM ID",
        placeholder: "C0123456789",
        validate: (value) =>
          slackChannelSchema.safeParse(value?.trim()).success
            ? undefined
            : "Expected a Slack channel or DM ID starting with C, D, or G",
      });

      if (p.isCancel(channel)) {
        p.cancel("Profile creation cancelled.");

        return;
      }

      const rawProvider = await p.text({
        message: "Model provider",
        placeholder: "anthropic",
        validate: (value) =>
          llmProviderSchema.safeParse(value?.trim()).success
            ? undefined
            : "Use a lowercase provider slug such as anthropic or openai",
      });

      if (p.isCancel(rawProvider)) {
        p.cancel("Profile creation cancelled.");

        return;
      }

      const provider = llmProviderSchema.parse(rawProvider.trim());
      const modelId = await p.text({
        message: "Model ID",
        placeholder: "claude-sonnet-4-5",
        validate: (value) => (value?.trim() ? undefined : "A model ID is required"),
      });

      if (p.isCancel(modelId)) {
        p.cancel("Profile creation cancelled.");

        return;
      }

      const selectedStarters = await p.multiselect({
        message: "Starters to copy into this profile",
        required: false,
        options: starters.map((starter) => ({
          value: starter.id,
          label: starter.id,
          hint: `${starter.kind}, ${starter.category}`,
        })),
      });

      if (p.isCancel(selectedStarters)) {
        p.cancel("Profile creation cancelled.");

        return;
      }

      const existingSecrets = await listRemoteSecrets(sshAlias);
      const llmStatus = await ensureLlmProviderSecret({
        sshAlias,
        provider,
        existing: existingSecrets,
      });

      if (llmStatus === "cancelled") {
        p.cancel("Profile creation cancelled.");

        return;
      }

      const starterStatus = await ensureRequiredSecrets({
        sshAlias,
        required: collectStarterSecrets(selectedStarters),
        existing: existingSecrets,
      });

      if (starterStatus === "cancelled") {
        p.cancel("Profile creation cancelled.");

        return;
      }

      const starterArgs = selectedStarters.flatMap((starterId) => ["--starter", starterId]);
      const code = await runDaemonCommand(sshAlias, [
        "profiles",
        "create",
        id,
        "--name",
        name.trim(),
        "--channel",
        channel.trim(),
        "--provider",
        provider,
        "--model",
        modelId.trim(),
        ...starterArgs,
      ]);

      process.exitCode = code;

      if (code === 0) {
        p.outro(`Created profile ${pc.cyan(id)}.`);
      }
    });
}
