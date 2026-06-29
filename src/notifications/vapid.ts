import webpush from "web-push";
import type { SettingsManager } from "../core/settings-manager.js";
import type { Logger } from "../core/logger.js";

// ============================================================
// VAPID keys for Web Push (spec 127)
// ============================================================

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const KEY_PUBLIC = "push.vapidPublicKey";
const KEY_PRIVATE = "push.vapidPrivateKey";
const KEY_SUBJECT = "push.vapidSubject";
const DEFAULT_SUBJECT = "mailto:admin@sowel.local";

/**
 * Ensure a VAPID key pair exists in `settings`, generating + persisting one on
 * first call. The private key never leaves the server. Idempotent: a second
 * call reuses the stored keys.
 */
export function ensureVapidKeys(settings: SettingsManager, logger: Logger): VapidKeys {
  const log = logger.child({ module: "vapid" });
  const publicKey = settings.get(KEY_PUBLIC);
  const privateKey = settings.get(KEY_PRIVATE);
  const subject = settings.get(KEY_SUBJECT);

  if (publicKey && privateKey) {
    const subj = subject || DEFAULT_SUBJECT;
    if (!subject) settings.set(KEY_SUBJECT, subj);
    return { publicKey, privateKey, subject: subj };
  }

  const generated = webpush.generateVAPIDKeys();
  const subj = subject || DEFAULT_SUBJECT;
  settings.setMany({
    [KEY_PUBLIC]: generated.publicKey,
    [KEY_PRIVATE]: generated.privateKey,
    [KEY_SUBJECT]: subj,
  });
  log.info("Generated and stored a new VAPID key pair");
  return { publicKey: generated.publicKey, privateKey: generated.privateKey, subject: subj };
}
