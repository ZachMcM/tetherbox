import { parseArgs } from "node:util";
import { getLlmOAuthProvider, llmProviderSchema } from "@tetherbox/core";
import type { LlmOAuth } from "../credentials/llm-oauth.ts";
import { formatExpiry } from "../credentials/oauth-store.ts";
import { withTerminalAuth } from "./terminal-auth.ts";

export async function runLlmCommand(llmOAuth: LlmOAuth, args: string[]): Promise<void> {
  const [action, rawProvider] = args;

  switch (action) {
    case "login": {
      const provider = llmProviderSchema.parse(rawProvider);
      const oauthProvider = getLlmOAuthProvider(provider);

      if (oauthProvider === undefined) {
        throw new Error(`provider "${provider}" has no OAuth login`);
      }

      console.log(`Logging in to ${oauthProvider.label}...`);

      const login = await withTerminalAuth((interaction) => llmOAuth.login(provider, interaction));

      console.log(`stored ${provider} OAuth login`);
      console.log(`access token expires ${formatExpiry(login.expires)}`);

      return;
    }
    case "logout":
      await llmOAuth.logout(llmProviderSchema.parse(rawProvider));

      return;
    case "status": {
      const { values } = parseArgs({
        args: args.slice(1),
        options: { json: { type: "boolean", default: false } },
      });
      const logins = (await llmOAuth.list()).map((login) => ({
        provider: login.provider,
        expires: formatExpiry(login.expires),
      }));

      if (values.json) {
        console.log(JSON.stringify(logins));

        return;
      }

      for (const login of logins) {
        console.log(`${login.provider}\t${login.expires}`);
      }

      return;
    }
    default:
      throw new Error("usage: tetherbox-daemon llm <login|logout|status> [provider]");
  }
}
