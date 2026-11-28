import type { PushHandlers } from "@tetherbox/core";
import type { PushSubscriptionTable } from "../../../db/push-subscriptions.ts";
import type { VapidKeys } from "../../../credentials/vapid.ts";

export function createPushHandlers({
  pushSubscriptions,
  vapidKeys,
}: {
  pushSubscriptions: PushSubscriptionTable;
  vapidKeys: VapidKeys;
}): PushHandlers {
  return {
    getVapidPublicKey: () => ({ publicKey: vapidKeys.publicKey }),
    upsertSubscription(input) {
      pushSubscriptions.upsert({ ...input, createdAt: new Date().toISOString() });
    },
    deleteSubscription: (endpoint) => ({ deleted: pushSubscriptions.delete(endpoint) }),
  };
}
