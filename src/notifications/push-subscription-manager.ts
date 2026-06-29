import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import { toISOUtc } from "../core/database.js";
import type { PushSubscription } from "../shared/types.js";

// ============================================================
// PushSubscriptionManager — per-user browser Web Push subscriptions (spec 127)
// ============================================================

interface SubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}

function rowToSubscription(row: SubscriptionRow): PushSubscription {
  return {
    id: row.id,
    userId: row.user_id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    userAgent: row.user_agent ?? undefined,
    createdAt: toISOUtc(row.created_at),
  };
}

export class PushSubscriptionManager {
  private readonly logger;
  private readonly stmts;

  constructor(db: Database.Database, logger: Logger) {
    this.logger = logger.child({ module: "push-subscription-manager" });
    this.stmts = {
      getByEndpoint: db.prepare(`SELECT * FROM push_subscriptions WHERE endpoint = ?`),
      insert: db.prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      ),
      updateByEndpoint: db.prepare(
        `UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, user_agent = ? WHERE endpoint = ?`,
      ),
      listAll: db.prepare(`SELECT * FROM push_subscriptions ORDER BY created_at`),
      listByUser: db.prepare(
        `SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY created_at`,
      ),
      deleteByEndpoint: db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`),
      deleteByEndpointForUser: db.prepare(
        `DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?`,
      ),
    };
  }

  /** Store a subscription for a user, upserting by endpoint. */
  upsert(userId: string, input: PushSubscriptionInput): PushSubscription {
    const existing = this.stmts.getByEndpoint.get(input.endpoint) as SubscriptionRow | undefined;
    if (existing) {
      this.stmts.updateByEndpoint.run(
        userId,
        input.p256dh,
        input.auth,
        input.userAgent ?? null,
        input.endpoint,
      );
    } else {
      this.stmts.insert.run(
        randomUUID(),
        userId,
        input.endpoint,
        input.p256dh,
        input.auth,
        input.userAgent ?? null,
      );
    }
    const row = this.stmts.getByEndpoint.get(input.endpoint) as SubscriptionRow;
    this.logger.info({ userId, endpoint: input.endpoint.slice(0, 40) }, "Push subscription stored");
    return rowToSubscription(row);
  }

  listAll(): PushSubscription[] {
    return (this.stmts.listAll.all() as SubscriptionRow[]).map(rowToSubscription);
  }

  listByUser(userId: string): PushSubscription[] {
    return (this.stmts.listByUser.all(userId) as SubscriptionRow[]).map(rowToSubscription);
  }

  /** Remove a subscription by endpoint. When `userId` is given, only the
   *  caller's own subscription is removed; otherwise (e.g. server-side pruning
   *  of an expired endpoint) it is removed regardless of owner. */
  deleteByEndpoint(endpoint: string, userId?: string): void {
    if (userId) this.stmts.deleteByEndpointForUser.run(endpoint, userId);
    else this.stmts.deleteByEndpoint.run(endpoint);
  }
}
