// ============================================================
// NotificationChannel — interface for channel providers
// ============================================================

/**
 * A notification split into a heading and an optional detail line. Channels
 * that support rich notifications (Web Push) render them as title + body so
 * the text is readable instead of crammed onto one truncated line; plain-text
 * channels (Telegram) flatten them back into a single message.
 */
export interface NotificationContent {
  title: string;
  body?: string;
  /**
   * Spec 188 O6 — the same notification worded per language. A channel that
   * knows its recipient's language (Web Push: each subscription belongs to a
   * user) picks it; the others send `title` / `body`.
   */
  localized?: Partial<Record<"en" | "fr", { title: string; body?: string }>>;
}

export interface NotificationChannel {
  /** Send a notification. */
  send(config: unknown, content: NotificationContent): Promise<void>;

  /** Test that the channel configuration is valid. */
  testConnection(config: unknown): Promise<void>;
}
