import { z } from "zod";
import { secretKeySchema, type SecretKey } from "./ids.ts";
import { hostnameSchema } from "./secrets.ts";

export const DEFAULT_OAUTH_CALLBACK_PORT = 47823;
export const DEFAULT_OAUTH_CALLBACK_PATH = "/oauth/callback";

const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => URL.parse(value)?.protocol === "https:", "expected an https:// URL");

export const oauthProviderIds = ["google"] as const;
export const oauthProviderSchema = z.enum(oauthProviderIds);
export type OAuthProviderId = z.infer<typeof oauthProviderSchema>;

export const oauthPresetIds = ["gcal", "gdrive", "gmail"] as const;
export const oauthPresetSchema = z.enum(oauthPresetIds);
export type OAuthPresetId = z.infer<typeof oauthPresetSchema>;

export const oauthScopeModeSchema = z.enum(["read-only", "read-write"]);
export type OAuthScopeMode = z.infer<typeof oauthScopeModeSchema>;

export interface OAuthProviderConfig {
  readonly id: OAuthProviderId;
  readonly label: string;
  readonly authorizationUrl: string;
  readonly tokenUrl: string;
  readonly extraAuthParams?: Readonly<Record<string, string>>;
  readonly callbackPort: number;
  readonly callbackPath: string;
  readonly clientIdSecretKey: SecretKey;
  readonly clientSecretSecretKey: SecretKey;
}

export interface OAuthPreset {
  readonly id: OAuthPresetId;
  readonly provider: OAuthProviderId;
  readonly label: string;
  readonly secretKey: SecretKey;
  readonly domains: readonly [string, ...string[]];
  readonly defaultScopeMode: OAuthScopeMode;
  readonly scopes: Readonly<Record<OAuthScopeMode, readonly [string, ...string[]]>>;
}

export const oauthProviders = [
  {
    id: "google",
    label: "Google",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    extraAuthParams: {
      access_type: "offline",
      prompt: "consent",
    },
    callbackPort: DEFAULT_OAUTH_CALLBACK_PORT,
    callbackPath: DEFAULT_OAUTH_CALLBACK_PATH,
    clientIdSecretKey: secretKeySchema.parse("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecretSecretKey: secretKeySchema.parse("GOOGLE_OAUTH_CLIENT_SECRET"),
  },
] as const satisfies readonly OAuthProviderConfig[];

export const oauthPresets = [
  {
    id: "gcal",
    provider: "google",
    label: "Google Calendar",
    secretKey: secretKeySchema.parse("GOOGLE_CALENDAR_OAUTH"),
    domains: ["www.googleapis.com"],
    defaultScopeMode: "read-write",
    scopes: {
      "read-only": ["https://www.googleapis.com/auth/calendar.readonly"],
      "read-write": ["https://www.googleapis.com/auth/calendar"],
    },
  },
  {
    id: "gdrive",
    provider: "google",
    label: "Google Drive",
    secretKey: secretKeySchema.parse("GOOGLE_DRIVE_OAUTH"),
    domains: ["www.googleapis.com"],
    defaultScopeMode: "read-only",
    scopes: {
      "read-only": ["https://www.googleapis.com/auth/drive.readonly"],
      "read-write": ["https://www.googleapis.com/auth/drive"],
    },
  },
  {
    id: "gmail",
    provider: "google",
    label: "Gmail",
    secretKey: secretKeySchema.parse("GOOGLE_GMAIL_OAUTH"),
    domains: ["gmail.googleapis.com"],
    defaultScopeMode: "read-write",
    scopes: {
      "read-only": ["https://www.googleapis.com/auth/gmail.readonly"],
      "read-write": ["https://www.googleapis.com/auth/gmail.modify"],
    },
  },
] as const satisfies readonly OAuthPreset[];

const providersById = new Map<OAuthProviderId, OAuthProviderConfig>(
  oauthProviders.map((provider) => [provider.id, provider]),
);

const presetsById = new Map<OAuthPresetId, OAuthPreset>(
  oauthPresets.map((preset) => [preset.id, preset]),
);

export function getOAuthProvider(id: OAuthProviderId): OAuthProviderConfig {
  const provider = providersById.get(id);

  if (provider === undefined) {
    throw new Error(`unknown OAuth provider "${id}"`);
  }

  return provider;
}

export function getOAuthPreset(id: string): OAuthPreset | undefined {
  const parsed = oauthPresetSchema.safeParse(id);

  return parsed.success ? presetsById.get(parsed.data) : undefined;
}

export const customOAuthLoginSchema = z.object({
  secretKey: secretKeySchema,
  authorizationUrl: httpsUrlSchema,
  tokenUrl: httpsUrlSchema,
  domains: z.array(hostnameSchema).nonempty(),
  scopes: z.array(z.string().min(1)).nonempty(),
  clientIdSecretKey: secretKeySchema,
  clientSecretSecretKey: secretKeySchema.optional(),
  callbackPort: z.number().int().min(1).max(65535).default(DEFAULT_OAUTH_CALLBACK_PORT),
  callbackPath: z.string().startsWith("/").default(DEFAULT_OAUTH_CALLBACK_PATH),
  extraAuthParams: z.record(z.string().min(1), z.string()).optional(),
});
export type CustomOAuthLoginInput = z.input<typeof customOAuthLoginSchema>;

export const oauthStatusEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("preset"),
    preset: oauthPresetSchema,
    provider: oauthProviderSchema,
    secretKey: secretKeySchema,
    scopeMode: oauthScopeModeSchema,
    scopes: z.array(z.string().min(1)).nonempty(),
    domains: z.array(hostnameSchema).nonempty(),
    expires: z.string().min(1),
  }),
  z.object({
    kind: z.literal("custom"),
    secretKey: secretKeySchema,
    tokenUrl: httpsUrlSchema,
    scopes: z.array(z.string().min(1)).nonempty(),
    domains: z.array(hostnameSchema).nonempty(),
    expires: z.string().min(1),
  }),
]);
export const oauthStatusListSchema = z.array(oauthStatusEntrySchema);
export type OAuthStatusEntry = z.infer<typeof oauthStatusEntrySchema>;
