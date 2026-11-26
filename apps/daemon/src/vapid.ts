import { generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { isMissing } from "./file-store.ts";

const vapidKeyFileSchema = z.object({
  publicKey: z.string().min(1),
  privateJwk: z.looseObject({
    kty: z.literal("EC"),
    crv: z.literal("P-256"),
    d: z.string().min(1),
    x: z.string().min(1),
    y: z.string().min(1),
  }),
});

export type VapidKeys = z.infer<typeof vapidKeyFileSchema>;

function generateVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicJwk = z
    .object({ x: z.string().min(1), y: z.string().min(1) })
    .parse(publicKey.export({ format: "jwk" }));
  const uncompressed = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(publicJwk.x, "base64url"),
    Buffer.from(publicJwk.y, "base64url"),
  ]).toString("base64url");

  return vapidKeyFileSchema.parse({
    publicKey: uncompressed,
    privateJwk: privateKey.export({ format: "jwk" }),
  });
}

export function loadOrCreateVapidKeys(dataDir: string): VapidKeys {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  const path = join(dataDir, "vapid.json");

  try {
    return vapidKeyFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }

  const keys = generateVapidKeys();

  writeFileSync(path, `${JSON.stringify(keys, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);

  return keys;
}
