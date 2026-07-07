import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  NotificationPublisherManager,
  NotificationPublisherError,
} from "./notification-publisher-manager.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";

const MIGRATIONS_DIR = resolve(import.meta.dirname ?? ".", "../../migrations");

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(resolve(MIGRATIONS_DIR, file), "utf-8"));
  }
  return db;
}

const logger = createLogger("silent").logger;

describe("NotificationPublisherManager — channel validation (spec 127)", () => {
  let db: Database.Database;
  let manager: NotificationPublisherManager;

  beforeEach(() => {
    db = createTestDb();
    manager = new NotificationPublisherManager(db, new EventBus(logger), logger);
  });

  afterEach(() => db.close());

  // ── Telegram retro-compat ──────────────────────────────────

  it("creates a telegram publisher with valid config", () => {
    const p = manager.create({
      name: "Telegram",
      channelType: "telegram",
      channelConfig: { botToken: "tok", chatId: "123" },
    });
    expect(p.channelType).toBe("telegram");
    expect(p.channelConfig).toEqual({ botToken: "tok", chatId: "123" });
  });

  it("rejects a telegram publisher missing botToken", () => {
    expect(() =>
      manager.create({
        name: "Telegram",
        channelType: "telegram",
        channelConfig: { botToken: "", chatId: "123" } as never,
      }),
    ).toThrow(NotificationPublisherError);
  });

  it("rejects a telegram publisher missing chatId", () => {
    expect(() =>
      manager.create({
        name: "Telegram",
        channelType: "telegram",
        channelConfig: { botToken: "tok", chatId: "" } as never,
      }),
    ).toThrow(/chatId/);
  });

  // ── Web Push ───────────────────────────────────────────────

  it("creates a web-push publisher with no per-publisher config", () => {
    const p = manager.create({
      name: "App Push",
      channelType: "web-push",
      channelConfig: {},
    });
    expect(p.channelType).toBe("web-push");
    expect(p.channelConfig).toEqual({});
    expect(manager.getById(p.id)?.channelType).toBe("web-push");
  });

  it("round-trips a web-push publisher through getAll", () => {
    manager.create({ name: "App Push", channelType: "web-push", channelConfig: {} });
    const all = manager.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].channelType).toBe("web-push");
  });

  // ── Update switches channel type with re-validation ────────

  it("updating to telegram re-validates the config", () => {
    const p = manager.create({ name: "App Push", channelType: "web-push", channelConfig: {} });
    expect(() =>
      manager.update(p.id, { channelType: "telegram", channelConfig: {} as never }),
    ).toThrow(/botToken/);
  });

  it("updating a web-push publisher's name keeps it valid", () => {
    const p = manager.create({ name: "App Push", channelType: "web-push", channelConfig: {} });
    const updated = manager.update(p.id, { name: "Renamed" });
    expect(updated.name).toBe("Renamed");
    expect(updated.channelType).toBe("web-push");
  });
});

describe("NotificationPublisherManager — mapping re-notify (spec 128)", () => {
  let db: Database.Database;
  let manager: NotificationPublisherManager;
  let pubId: string;

  beforeEach(() => {
    db = createTestDb();
    manager = new NotificationPublisherManager(db, new EventBus(logger), logger);
    pubId = manager.create({ name: "P", channelType: "web-push", channelConfig: {} }).id;
  });
  afterEach(() => db.close());

  const base = { message: "m", sourceType: "recipe" as const, sourceId: "i1", sourceKey: "alarm" };

  it("persists repeatMs + repeatMax", () => {
    const m = manager.addMapping(pubId, { ...base, repeatMs: 60_000, repeatMax: 3 });
    expect(m.repeatMs).toBe(60_000);
    expect(m.repeatMax).toBe(3);
    expect(manager.getMappings(pubId)[0].repeatMs).toBe(60_000);
  });

  it("defaults to null repeat when omitted", () => {
    const m = manager.addMapping(pubId, { ...base });
    expect(m.repeatMs).toBeNull();
    expect(m.repeatMax).toBeNull();
  });

  it("rejects repeatMax without repeatMs", () => {
    expect(() => manager.addMapping(pubId, { ...base, repeatMax: 3 })).toThrow(
      /repeatMax requires/i,
    );
  });

  it("rejects a non-positive repeatMs", () => {
    expect(() => manager.addMapping(pubId, { ...base, repeatMs: 0 })).toThrow(/repeatMs/i);
    expect(() => manager.addMapping(pubId, { ...base, sourceKey: "x", repeatMs: -5 })).toThrow(
      /repeatMs/i,
    );
  });

  it("update can set then clear the repeat config", () => {
    const m = manager.addMapping(pubId, { ...base, repeatMs: 60_000, repeatMax: 3 });
    const cleared = manager.updateMapping(pubId, m.id, { repeatMs: null, repeatMax: null });
    expect(cleared.repeatMs).toBeNull();
    expect(cleared.repeatMax).toBeNull();
  });
});
