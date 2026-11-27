import type { PushHandlers } from "@tetherbox/core";
import type { DaemonDb } from "../db.ts";
import type { VapidKeys } from "../vapid.ts";

export function createPushHandlers({
  db,
  vapidKeys,
}: {
  db: DaemonDb;
  vapidKeys: VapidKeys;
}): PushHandlers {
  return {
    getVapidPublicKey: () => ({ publicKey: vapidKeys.publicKey }),
    upsertSubscription(input) {
      db.upsertPushSubscription({ ...input, createdAt: new Date().toISOString() });
    },
    deleteSubscription: (endpoint) => ({ deleted: db.deletePushSubscription(endpoint) }),
  };
}
