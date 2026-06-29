import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let generateCalls = 0;
vi.mock("web-push", () => ({
  default: {
    generateVAPIDKeys: () => {
      generateCalls += 1;
      return { publicKey: `pub-${generateCalls}`, privateKey: `priv-${generateCalls}` };
    },
  },
}));

import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureVapidKeys } from "./vapid.js";
import { SettingsManager } from "../core/settings-manager.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("silent").logger;

function createSettings(): { settings: SettingsManager; db: Database.Database } {
  const db = new Database(":memory:");
  db.exec(
    readFileSync(resolve(import.meta.dirname ?? ".", "../../migrations/001_initial.sql"), "utf-8"),
  );
  return { settings: new SettingsManager(db), db };
}

describe("ensureVapidKeys", () => {
  let settings: SettingsManager;
  let db: Database.Database;

  beforeEach(() => {
    generateCalls = 0;
    ({ settings, db } = createSettings());
  });

  afterEach(() => db.close());

  const DEFAULT_SUBJECT = "mailto:admin@sowel.org";

  it("generates and persists a key pair on first call", () => {
    const keys = ensureVapidKeys(settings, logger);
    expect(keys.publicKey).toBe("pub-1");
    expect(keys.privateKey).toBe("priv-1");
    expect(keys.subject).toBe(DEFAULT_SUBJECT);
    expect(settings.get("push.vapidPublicKey")).toBe("pub-1");
    expect(settings.get("push.vapidPrivateKey")).toBe("priv-1");
    expect(settings.get("push.vapidSubject")).toBe(DEFAULT_SUBJECT);
  });

  it("uses a valid (non-.local) default subject Apple accepts", () => {
    const keys = ensureVapidKeys(settings, logger);
    expect(keys.subject).not.toContain(".local");
    expect(keys.subject).toMatch(/^(mailto:|https:)/);
  });

  it("is idempotent: a second call reuses the stored keys", () => {
    const first = ensureVapidKeys(settings, logger);
    const second = ensureVapidKeys(settings, logger);
    expect(generateCalls).toBe(1);
    expect(second).toEqual(first);
  });

  it("backfills a missing subject without regenerating keys", () => {
    settings.set("push.vapidPublicKey", "existing-pub");
    settings.set("push.vapidPrivateKey", "existing-priv");
    const keys = ensureVapidKeys(settings, logger);
    expect(generateCalls).toBe(0);
    expect(keys.publicKey).toBe("existing-pub");
    expect(keys.subject).toBe(DEFAULT_SUBJECT);
    expect(settings.get("push.vapidSubject")).toBe(DEFAULT_SUBJECT);
  });

  it("heals a legacy .local subject on boot without touching the keys", () => {
    settings.set("push.vapidPublicKey", "existing-pub");
    settings.set("push.vapidPrivateKey", "existing-priv");
    settings.set("push.vapidSubject", "mailto:admin@sowel.local");
    const keys = ensureVapidKeys(settings, logger);
    expect(generateCalls).toBe(0); // key pair untouched
    expect(keys.publicKey).toBe("existing-pub");
    expect(keys.privateKey).toBe("existing-priv");
    expect(keys.subject).toBe(DEFAULT_SUBJECT);
    expect(settings.get("push.vapidSubject")).toBe(DEFAULT_SUBJECT); // persisted
  });

  it("preserves a custom valid stored subject", () => {
    settings.set("push.vapidSubject", "mailto:owner@example.com");
    const keys = ensureVapidKeys(settings, logger);
    expect(keys.subject).toBe("mailto:owner@example.com");
  });
});
