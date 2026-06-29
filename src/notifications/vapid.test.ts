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

  it("generates and persists a key pair on first call", () => {
    const keys = ensureVapidKeys(settings, logger);
    expect(keys.publicKey).toBe("pub-1");
    expect(keys.privateKey).toBe("priv-1");
    expect(keys.subject).toBe("mailto:admin@sowel.local");
    expect(settings.get("push.vapidPublicKey")).toBe("pub-1");
    expect(settings.get("push.vapidPrivateKey")).toBe("priv-1");
    expect(settings.get("push.vapidSubject")).toBe("mailto:admin@sowel.local");
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
    expect(keys.subject).toBe("mailto:admin@sowel.local");
    expect(settings.get("push.vapidSubject")).toBe("mailto:admin@sowel.local");
  });

  it("preserves a custom stored subject", () => {
    settings.set("push.vapidSubject", "mailto:owner@example.com");
    const keys = ensureVapidKeys(settings, logger);
    expect(keys.subject).toBe("mailto:owner@example.com");
  });
});
