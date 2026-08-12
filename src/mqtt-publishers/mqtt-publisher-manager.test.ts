import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { MqttPublisherManager } from "./mqtt-publisher-manager.js";
import { applyMigrations } from "../test-helpers/migrations.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return db;
}

const logger = createLogger("silent").logger;

describe("MqttPublisherManager — mapping enabled flag", () => {
  let db: Database.Database;
  let manager: MqttPublisherManager;
  let publisherId: string;

  beforeEach(() => {
    db = createTestDb();
    const eventBus = new EventBus(logger);
    manager = new MqttPublisherManager(db, eventBus, logger);
    const pub = manager.create({ name: "Test", brokerId: null, topic: "test/topic" });
    publisherId = pub.id;
  });

  it("addMapping without enabled defaults to enabled=true", () => {
    const m = manager.addMapping(publisherId, {
      publishKey: "k",
      sourceType: "equipment",
      sourceId: "eq-1",
      sourceKey: "alias",
    });
    expect(m.enabled).toBe(true);
  });

  it("addMapping with enabled=false stores enabled=false", () => {
    const m = manager.addMapping(publisherId, {
      publishKey: "k",
      sourceType: "equipment",
      sourceId: "eq-1",
      sourceKey: "alias",
      enabled: false,
    });
    expect(m.enabled).toBe(false);
  });

  it("updateMapping with enabled=false flips the flag and persists it", () => {
    const m = manager.addMapping(publisherId, {
      publishKey: "k",
      sourceType: "zone",
      sourceId: "z-1",
      sourceKey: "temperature",
    });
    const updated = manager.updateMapping(publisherId, m.id, { enabled: false });
    expect(updated.enabled).toBe(false);

    const reloaded = manager.getMappings(publisherId).find((x) => x.id === m.id);
    expect(reloaded?.enabled).toBe(false);
  });

  it("updateMapping without enabled preserves the existing value", () => {
    const m = manager.addMapping(publisherId, {
      publishKey: "k",
      sourceType: "equipment",
      sourceId: "eq-1",
      sourceKey: "alias",
      enabled: false,
    });
    const updated = manager.updateMapping(publisherId, m.id, { publishKey: "k2" });
    expect(updated.enabled).toBe(false);
    expect(updated.publishKey).toBe("k2");
  });
});
