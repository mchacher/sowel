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
  label: string | null;
  last_sent_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
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
    label: row.label ?? undefined,
    lastSentAt: toISOUtc(row.last_sent_at) ?? undefined,
    lastSuccessAt: toISOUtc(row.last_success_at) ?? undefined,
    lastError: row.last_error ?? undefined,
    consecutiveFailures: row.consecutive_failures,
  };
}

/** Longest label an owner can give a device (spec 199). */
export const PUSH_LABEL_MAX_LENGTH = 60;

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
        `UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, user_agent = ?,
           consecutive_failures = 0, last_error = NULL
         WHERE endpoint = ?`,
      ),
      getById: db.prepare(`SELECT * FROM push_subscriptions WHERE id = ?`),
      recordSuccess: db.prepare(
        `UPDATE push_subscriptions
         SET last_sent_at = datetime('now'), last_success_at = datetime('now'),
             last_error = NULL, consecutive_failures = 0
         WHERE id = ?`,
      ),
      recordFailure: db.prepare(
        `UPDATE push_subscriptions
         SET last_sent_at = datetime('now'), last_error = ?,
             consecutive_failures = consecutive_failures + 1
         WHERE id = ?
         RETURNING consecutive_failures`,
      ),
      renameForUser: db.prepare(
        `UPDATE push_subscriptions SET label = ? WHERE id = ? AND user_id = ?`,
      ),
      deleteById: db.prepare(`DELETE FROM push_subscriptions WHERE id = ?`),
      deleteByIdForUser: db.prepare(`DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?`),
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

  /** Spec 199 — the push service accepted a send (2xx): clears the failure run. */
  recordSuccess(id: string): void {
    this.stmts.recordSuccess.run(id);
  }

  /** Spec 199 — a send failed; returns the failures in a row (0 if the row is gone). */
  recordFailure(id: string, error: string): number {
    const row = this.stmts.recordFailure.get(error.slice(0, 500), id) as
      { consecutive_failures: number } | undefined;
    return row?.consecutive_failures ?? 0;
  }

  /** Spec 199 — name one of the caller's devices; null or blank clears the name.
   *  Returns null when the id is not the caller's. */
  rename(id: string, userId: string, label: string | null): PushSubscription | null {
    const trimmed = label?.trim().slice(0, PUSH_LABEL_MAX_LENGTH) || null;
    const { changes } = this.stmts.renameForUser.run(trimmed, id, userId);
    if (changes === 0) return null;
    return rowToSubscription(this.stmts.getById.get(id) as SubscriptionRow);
  }

  /** Spec 199 — remove a subscription by id. With `userId`, only the caller's
   *  own; without, regardless of owner (server-side pruning). */
  deleteById(id: string, userId?: string): boolean {
    const { changes } = userId
      ? this.stmts.deleteByIdForUser.run(id, userId)
      : this.stmts.deleteById.run(id);
    return changes > 0;
  }
}
