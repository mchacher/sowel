import webpush from "web-push";
import type { Logger } from "../../core/logger.js";
import type { NotificationChannel } from "./channel.js";
import type { PushSubscriptionManager } from "../push-subscription-manager.js";
import type { VapidKeys } from "../vapid.js";

// ============================================================
// Web Push — W3C Push Protocol channel provider (spec 127)
// ============================================================

/**
 * Broadcasts a notification to every stored browser subscription using VAPID.
 * No per-publisher config: the recipients are the `push_subscriptions` rows,
 * the credentials are the server-global VAPID keys. Expired endpoints
 * (404/410) are pruned; other per-endpoint failures are logged without
 * aborting delivery to the rest.
 */
export class WebPushChannel implements NotificationChannel {
  private readonly logger;

  constructor(
    private readonly subscriptions: PushSubscriptionManager,
    private readonly vapid: VapidKeys,
    logger: Logger,
  ) {
    this.logger = logger.child({ module: "web-push-channel" });
  }

  async send(_config: unknown, text: string): Promise<void> {
    const subs = this.subscriptions.listAll();
    if (subs.length === 0) {
      this.logger.debug("No push subscriptions; nothing to send");
      return;
    }

    // The message is the notification heading. We deliberately do NOT set a
    // "Sowel" title: the installed PWA (and the browser/site chrome) already
    // labels the notification with the app name, so a "Sowel" title would just
    // be shown twice.
    const payload = JSON.stringify({ title: text });
    const vapidDetails = {
      subject: this.vapid.subject,
      publicKey: this.vapid.publicKey,
      privateKey: this.vapid.privateKey,
    };

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
            { vapidDetails },
          );
        } catch (err: unknown) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            this.subscriptions.deleteByEndpoint(s.endpoint);
            this.logger.info(
              { endpoint: s.endpoint.slice(0, 40) },
              "Pruned expired push subscription",
            );
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              { endpoint: s.endpoint.slice(0, 40), status, err: msg },
              "Web push send failed",
            );
          }
        }
      }),
    );
  }

  async testConnection(config: unknown): Promise<void> {
    if (!this.vapid.publicKey || !this.vapid.privateKey) {
      throw new Error("VAPID keys are not configured");
    }
    // Unlike a connect-and-check channel, the only meaningful "test" for Web
    // Push is to deliver an actual notification to the registered devices
    // (mirrors how the Telegram channel sends a test message). Validating the
    // VAPID keys alone delivered nothing, so the test button looked broken.
    if (this.subscriptions.listAll().length === 0) {
      throw new Error("No push subscriptions yet — enable push on a device first");
    }
    await this.send(config, "Test notification");
  }
}
