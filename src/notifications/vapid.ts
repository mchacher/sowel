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

// Apple's Web Push gateway (web.push.apple.com) rejects the VAPID JWT with 403
// when the `sub` claim is not a real mailto:/https: contact. The original
// default used a `.local` domain, which Apple refuses (FCM is lenient and
// accepted it, so Chrome/Android worked but iOS did not).
const DEFAULT_SUBJECT = "mailto:admin@sowel.org";
// Bad defaults shipped before the fix — replaced on boot so existing instances
// self-heal. Changing only the subject is safe: it is a JWT claim, independent
// of the key pair, so stored browser subscriptions keep working.
const LEGACY_INVALID_SUBJECTS = new Set(["mailto:admin@sowel.local"]);

function resolveSubject(stored: string | undefined): string {
  return !stored || LEGACY_INVALID_SUBJECTS.has(stored) ? DEFAULT_SUBJECT : stored;
}

/**
 * Ensure a VAPID key pair exists in `settings`, generating + persisting one on
 * first call. The private key never leaves the server. Idempotent: a second
 * call reuses the stored keys. A missing or known-invalid subject is healed to
 * `DEFAULT_SUBJECT` and persisted (the key pair is left untouched).
 */
export function ensureVapidKeys(settings: SettingsManager, logger: Logger): VapidKeys {
  const log = logger.child({ module: "vapid" });
  const publicKey = settings.get(KEY_PUBLIC);
  const privateKey = settings.get(KEY_PRIVATE);
  const storedSubject = settings.get(KEY_SUBJECT);
  const subject = resolveSubject(storedSubject);

  if (publicKey && privateKey) {
    if (subject !== storedSubject) {
      settings.set(KEY_SUBJECT, subject);
      log.info({ subject }, "Healed VAPID subject");
    }
    return { publicKey, privateKey, subject };
  }

  const generated = webpush.generateVAPIDKeys();
  settings.setMany({
    [KEY_PUBLIC]: generated.publicKey,
    [KEY_PRIVATE]: generated.privateKey,
    [KEY_SUBJECT]: subject,
  });
  log.info("Generated and stored a new VAPID key pair");
  return { publicKey: generated.publicKey, privateKey: generated.privateKey, subject };
}
