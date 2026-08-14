import { describe, it, expect } from "vitest";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

/**
 * Regression guard for issue #501: the "Application mobile" QR login was removed
 * and the "Tokens API" section moved from a dedicated "System" tab into "Account".
 *
 * These assertions lock in the i18n cleanup so the dead QR keys and the orphaned
 * "System" tab label cannot silently reappear, and the token-management strings
 * that moved to the Account tab stay in place.
 */

const locales: Record<string, Record<string, string>> = { en, fr };

// Keys removed with the mobile QR login feature.
const REMOVED_KEYS = [
  "settings.mobile",
  "settings.mobileDescription",
  "settings.generateQr",
  "settings.regenerateQr",
  "settings.qrExpiry",
  "settings.qrExpiry7d",
  "settings.qrExpiry30d",
  "settings.qrExpiryNever",
  "settings.qrInstructions",
  "qrLogin.connecting",
  "qrLogin.invalidToken",
  "qrLogin.goToLogin",
  "qrLogin.error",
  "settings.tabs.system",
];

// Token-management keys that must survive the move to the Account tab.
const KEPT_KEYS = [
  "settings.apiTokens",
  "settings.createToken",
  "settings.tokenName",
  "settings.revokeToken",
  "settings.tabs.account",
];

describe("settings token relocation (#501)", () => {
  for (const [name, dict] of Object.entries(locales)) {
    describe(name, () => {
      it("drops every mobile QR / System-tab key", () => {
        for (const key of REMOVED_KEYS) {
          expect(dict, `${name}: ${key} should be removed`).not.toHaveProperty(key);
        }
      });

      it("keeps the API token management keys", () => {
        for (const key of KEPT_KEYS) {
          expect(dict, `${name}: ${key} should exist`).toHaveProperty(key);
        }
      });
    });
  }

  it("keeps en and fr locales in sync on these keys", () => {
    for (const key of [...REMOVED_KEYS, ...KEPT_KEYS]) {
      expect(key in en, `en ${key}`).toBe(key in fr);
    }
  });
});
