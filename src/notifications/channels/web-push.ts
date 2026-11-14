import { sendNotification } from "web-push";
import type { Logger } from "../../core/logger.js";
import type { NotificationChannel, NotificationContent } from "./channel.js";
import type { PushSubscriptionManager } from "../push-subscription-manager.js";
import type { VapidKeys } from "../vapid.js";

// ============================================================
// Web Push — W3C Push Protocol channel provider (spec 127)
// ============================================================

/**
 * Spec 199 — a subscription that fails this many sends in a row is deleted.
 * Apple may keep an endpoint alive for a removed home-screen app without ever
 * answering 404/410, so the status alone never prunes it.
 */
export const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Only a refusal by the push service about this subscription counts toward the
 * prune: a 4xx other than 429. A network error (no status), a 5xx or a 429
 * says nothing about the device, and an outage on Sowel's side must not wipe
 * every subscription.
 */
function countsTowardPrune(status: number | undefined): boolean {
  return status !== undefined && status >= 400 && status < 500 && status !== 429;
}

/**
 * Broadcasts a notification to every stored browser subscription using VAPID.
 * No per-publisher config: the recipients are the `push_subscriptions` rows,
 * the credentials are the server-global VAPID keys. Each outcome is recorded
 * on the subscription (spec 199). Expired endpoints (404/410) are pruned, and
 * so is one failing MAX_CONSECUTIVE_FAILURES times in a row; other failures
 * are logged without aborting delivery to the rest.
 */
export class WebPushChannel implements NotificationChannel {
  private readonly logger;

  constructor(
    private readonly subscriptions: PushSubscriptionManager,
    private readonly vapid: VapidKeys,
    logger: Logger,
    /** Spec 188 O6 — the language a subscription's owner reads Sowel in. */
    private readonly languageOf: (userId: string) => "en" | "fr" | undefined = () => undefined,
  ) {
    this.logger = logger.child({ module: "web-push-channel" });
  }

  async send(_config: unknown, content: NotificationContent): Promise<void> {
    const subs = this.subscriptions.listAll();
    if (subs.length === 0) {
      this.logger.debug("No push subscriptions; nothing to send");
      return;
    }

    // title = message, body = value detail. The service worker renders them on
    // separate lines so the text stays readable instead of being crammed onto
    // one truncated line. We deliberately do NOT set a "Sowel" title: the
    // installed PWA already labels the notification with the app name.
    const payloadFor = (userId: string): string => {
      const language = content.localized ? this.languageOf(userId) : undefined;
      const worded = (language && content.localized?.[language]) || content;
      return JSON.stringify({ title: worded.title, body: worded.body ?? "" });
    };
    const vapidDetails = {
      subject: this.vapid.subject,
      publicKey: this.vapid.publicKey,
      privateKey: this.vapid.privateKey,
    };

    await Promise.all(
      subs.map(async (s) => {
        try {
          await sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payloadFor(s.userId),
            { vapidDetails },
          );
          this.subscriptions.recordSuccess(s.id);
        } catch (err: unknown) {
          const status = (err as { statusCode?: number }).statusCode;
          const endpoint = s.endpoint.slice(0, 40);
          if (status === 404 || status === 410) {
            this.subscriptions.deleteByEndpoint(s.endpoint);
            this.logger.info({ endpoint, status }, "Pruned expired push subscription");
            return;
          }
          const msg = err instanceof Error ? err.message : String(err);
          const counts = countsTowardPrune(status);
          const failures = this.subscriptions.recordFailure(
            s.id,
            status ? `${status} ${msg}` : msg,
            counts,
          );
          // Not the raw error: a WebPushError carries the full endpoint.
          const errLog = { message: msg, statusCode: status };
          if (counts && failures >= MAX_CONSECUTIVE_FAILURES) {
            this.subscriptions.deleteById(s.id);
            this.logger.warn(
              { subscriptionId: s.id, userId: s.userId, endpoint, status, failures, err: errLog },
              "Pruned push subscription after consecutive failures",
            );
          } else {
            this.logger.warn(
              { subscriptionId: s.id, endpoint, status, failures, err: errLog },
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
    await this.send(config, { title: "Test notification" });
  }
}
