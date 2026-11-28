import type { DatabaseSync } from "node:sqlite";
import type { PushSubscriptionRecord } from "@tetherbox/core";

export class PushSubscriptionTable {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  upsert(sub: PushSubscriptionRecord): void {
    this.#db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (endpoint) DO UPDATE SET
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           created_at = excluded.created_at`,
      )
      .run(sub.endpoint, sub.p256dh, sub.auth, sub.createdAt);
  }

  delete(endpoint: string): boolean {
    const result = this.#db
      .prepare("DELETE FROM push_subscriptions WHERE endpoint = ?")
      .run(endpoint);

    return Number(result.changes) > 0;
  }
}
