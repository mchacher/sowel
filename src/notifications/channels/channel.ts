// ============================================================
// NotificationChannel — interface for channel providers
// ============================================================

export interface NotificationChannel {
  /** Send a notification message. */
  send(config: unknown, text: string): Promise<void>;

  /** Test that the channel configuration is valid. */
  testConnection(config: unknown): Promise<void>;
}
