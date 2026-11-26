import * as p from "@clack/prompts";
import { profileIdSchema } from "@tetherbox/core";
import { starters } from "@tetherbox/starters";
import type { Command } from "commander";
import pc from "picocolors";
import { readConfig } from "../config.ts";
import { ensureModelAuth, modelRefArgs, promptModelRef } from "../llm.ts";
import { runDaemonCommand } from "../remote.ts";
import { listRemoteSecrets } from "../secrets.ts";
import { ensureStarterSetup, starterConfigArgs } from "../starters.ts";

export function registerProfiles(program: Command): void {
  const profiles = program.command("profiles").description("Manage Tetherbox profiles on the VM");

  profiles
    .command("list")
    .description("List profiles on the VM")
    .action(async () => {
      const { sshAlias } = await readConfig();

      process.exitCode = await runDaemonCommand(sshAlias, ["profiles", "list"]);
    });

  profiles
    .command("validate")
    .description("Check a profile's config, cron, and webhook files")
    .argument("<id>", "profile id")
    .action(async (rawId: string) => {
      const id = profileIdSchema.parse(rawId);
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
    .description("Create a profile")
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

      const model = await promptModelRef();

      if (model === undefined) {
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
      const llmStatus = await ensureModelAuth({ sshAlias, model, existingSecrets });

      if (llmStatus === "cancelled") {
        p.cancel("Profile creation cancelled.");

        return;
      }

      const starterSetup = await ensureStarterSetup({
        sshAlias,
        starterIds: selectedStarters,
        existingSecrets,
      });

      if (starterSetup.kind === "cancelled") {
        p.cancel("Profile creation cancelled.");

        return;
      }

      const starterArgs = selectedStarters.map((starterId) => `--starter=${starterId}`);
      const code = await runDaemonCommand(sshAlias, [
        "profiles",
        "create",
        id,
        `--name=${name.trim()}`,
        ...modelRefArgs(model),
        ...starterArgs,
        ...starterConfigArgs(starterSetup.starterConfig),
      ]);

      process.exitCode = code;

      if (code === 0) {
        p.outro(`Created profile ${pc.cyan(id)}.`);
      }
    });

  profiles
    .command("set-model")
    .description("Change a profile's model and how it authenticates")
    .argument("<id>", "profile id")
    .action(async (rawId: string) => {
      const id = profileIdSchema.parse(rawId);
      const { sshAlias } = await readConfig();

      p.intro(pc.bold(`tetherbox profiles set-model ${id}`));

      const model = await promptModelRef();

      if (model === undefined) {
        p.cancel("Model change cancelled.");

        return;
      }

      const authStatus = await ensureModelAuth({
        sshAlias,
        model,
        existingSecrets: await listRemoteSecrets(sshAlias),
      });

      if (authStatus === "cancelled") {
        p.cancel("Model change cancelled.");

        return;
      }

      const code = await runDaemonCommand(sshAlias, [
        "profiles",
        "set-model",
        id,
        ...modelRefArgs(model),
      ]);

      process.exitCode = code;

      if (code === 0) {
        p.outro(`Profile ${pc.cyan(id)} now uses ${model.provider}/${model.id}.`);
      }
    });
}
