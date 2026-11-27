import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookVerification } from "@tetherbox/core";
import type { SecretStore } from "../../credentials/secret-store.ts";

export async function verifyWebhook(
  verify: WebhookVerification,
  headers: Headers,
  body: string,
  secrets: SecretStore,
): Promise<boolean> {
  switch (verify.kind) {
    case "public":
      return true;
    case "hmac-sha256": {
      const secret = await secrets.get(verify.secretKey);
      const signature = headers.get(verify.header)?.replace(/^sha256=/, "");

      if (secret === undefined || signature === undefined) {
        return false;
      }

      if (secret.binding.kind !== "daemon") {
        console.warn(
          `webhook secret ${verify.secretKey} has binding "${secret.binding.kind}", expected "daemon"`,
        );

        return false;
      }

      const expected = createHmac("sha256", secret.value).update(body).digest();
      const received = Buffer.from(signature, "hex");

      return received.length === expected.length && timingSafeEqual(received, expected);
    }
  }
}
