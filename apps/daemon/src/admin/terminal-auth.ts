import { createInterface, type Interface } from "node:readline/promises";
import type { AuthEvent, AuthPrompt, ProviderAuthInteraction } from "@earendil-works/pi-ai";

async function askSelect(
  readline: Interface,
  prompt: Extract<AuthPrompt, { type: "select" }>,
  signal: AbortSignal,
): Promise<string> {
  console.log(prompt.message);
  prompt.options.forEach((option, index) => {
    const description = option.description === undefined ? "" : ` (${option.description})`;

    console.log(`  ${index + 1}. ${option.label}${description}`);
  });

  for (;;) {
    const answer = (await readline.question("Choose [1]: ", { signal })).trim();
    const option = prompt.options[answer === "" ? 0 : Number(answer) - 1];

    if (option !== undefined) {
      return option.id;
    }

    console.log(`Enter a number from 1 to ${prompt.options.length}.`);
  }
}

function printEvent(event: AuthEvent): void {
  switch (event.type) {
    case "auth_url":
      console.log(`\nOpen this URL in your browser:\n\n  ${event.url}\n`);

      if (event.instructions !== undefined) {
        console.log(event.instructions);
      }

      return;
    case "device_code":
      console.log(`\nGo to ${event.verificationUri} and enter the code ${event.userCode}\n`);

      return;
    case "info":
      console.log(event.message);

      for (const link of event.links ?? []) {
        console.log(`  ${link.label ?? link.url}: ${link.url}`);
      }

      return;
    case "progress":
      console.log(event.message);

      return;
    default: {
      const exhaustive: never = event;

      return exhaustive;
    }
  }
}

/**
 * Drives a Pi login flow from the controlling terminal. The CLI runs this over `ssh -t` and
 * forwards the provider's callback port, so a browser redirect on the user's machine reaches the
 * flow's loopback server on the VM.
 */
export async function withTerminalAuth<T>(
  run: (interaction: ProviderAuthInteraction) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const readline = createInterface({ input: process.stdin, output: process.stdout });

  readline.once("SIGINT", () => controller.abort(new Error("Login cancelled")));

  const interaction: ProviderAuthInteraction = {
    signal: controller.signal,
    async prompt(prompt) {
      const signal = AbortSignal.any([
        controller.signal,
        ...(prompt.signal ? [prompt.signal] : []),
      ]);

      if (prompt.type === "select") {
        return askSelect(readline, prompt, signal);
      }

      const hint = prompt.placeholder === undefined ? "" : ` (${prompt.placeholder})`;

      return (await readline.question(`${prompt.message}${hint} `, { signal })).trim();
    },
    notify: printEvent,
  };

  try {
    return await run(interaction);
  } finally {
    readline.close();
  }
}
