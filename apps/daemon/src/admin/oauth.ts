import { parseArgs } from "node:util";
import {
  customOAuthLoginSchema,
  getOAuthPreset,
  oauthPresetSchema,
  oauthScopeModeSchema,
  secretKeySchema,
} from "@tetherbox/core";
import { formatExpiry, toOAuthStatusEntry, type OAuthStore } from "../credentials/oauth-store.ts";

export async function runOAuthCommand(oauth: OAuthStore, args: string[]): Promise<void> {
  const [action, rawTarget, ...rest] = args;

  switch (action) {
    case "login": {
      const presetId = oauthPresetSchema.parse(rawTarget);
      const { values } = parseArgs({
        args: rest,
        options: {
          scope: { type: "string" },
        },
      });
      const scopeMode =
        values.scope === undefined ? undefined : oauthScopeModeSchema.parse(values.scope);
      const preset = getOAuthPreset(presetId);

      if (preset === undefined) {
        throw new Error(`unknown OAuth preset "${presetId}"`);
      }

      console.log(`Logging in to ${preset.label}...`);

      const summary = await oauth.loginPreset(presetId, scopeMode);

      if (summary.kind === "preset") {
        console.log(
          `stored ${summary.preset} OAuth token as ${summary.secretKey} (${summary.scopeMode})`,
        );
      }

      console.log(`access token expires ${formatExpiry(summary.expiresAt)}`);

      return;
    }
    case "custom": {
      const secretKey = secretKeySchema.parse(rawTarget);
      const { values } = parseArgs({
        args: rest,
        options: {
          "auth-url": { type: "string" },
          "token-url": { type: "string" },
          domain: { type: "string", multiple: true, default: [] },
          scope: { type: "string", multiple: true, default: [] },
          "client-id-key": { type: "string" },
          "client-secret-key": { type: "string" },
          "callback-port": { type: "string" },
          "callback-path": { type: "string" },
          "auth-param": { type: "string", multiple: true, default: [] },
        },
      });
      const extraAuthParams: Record<string, string> = {};

      for (const rawParam of values["auth-param"]) {
        const sep = rawParam.indexOf("=");

        if (sep <= 0) {
          throw new Error(`invalid --auth-param "${rawParam}", expected key=value`);
        }

        extraAuthParams[rawParam.slice(0, sep)] = rawParam.slice(sep + 1);
      }

      const callbackPort =
        values["callback-port"] === undefined ? undefined : Number(values["callback-port"]);

      const customInput = customOAuthLoginSchema.parse({
        secretKey,
        authorizationUrl: values["auth-url"] ?? "",
        tokenUrl: values["token-url"] ?? "",
        domains: values.domain,
        scopes: values.scope,
        clientIdSecretKey: values["client-id-key"] ?? "",
        ...(values["client-secret-key"] !== undefined
          ? { clientSecretSecretKey: values["client-secret-key"] }
          : {}),
        ...(callbackPort !== undefined ? { callbackPort } : {}),
        ...(values["callback-path"] !== undefined ? { callbackPath: values["callback-path"] } : {}),
        ...(Object.keys(extraAuthParams).length > 0 ? { extraAuthParams } : {}),
      });

      console.log(`Logging in to custom OAuth2 integration ${secretKey}...`);

      const summary = await oauth.loginCustom(customInput);

      console.log(`stored custom OAuth token as ${summary.secretKey}`);
      console.log(`access token expires ${formatExpiry(summary.expiresAt)}`);

      return;
    }
    case "logout": {
      if (rawTarget === undefined) {
        throw new Error("usage: tetherbox-daemon oauth logout <preset|SECRET_KEY>");
      }

      await oauth.logout(rawTarget);

      return;
    }
    case "status": {
      const { values } = parseArgs({
        args: args.slice(1),
        options: { json: { type: "boolean", default: false } },
      });
      const entries = (await oauth.list()).map(toOAuthStatusEntry);

      if (values.json) {
        console.log(JSON.stringify(entries));

        return;
      }

      for (const entry of entries) {
        if (entry.kind === "preset") {
          console.log(`${entry.preset}\t${entry.secretKey}\t${entry.scopeMode}\t${entry.expires}`);
        } else {
          console.log(`custom\t${entry.secretKey}\t${entry.domains.join(",")}\t${entry.expires}`);
        }
      }

      return;
    }
    default:
      throw new Error("usage: tetherbox-daemon oauth <login|custom|logout|status> [target]");
  }
}
