import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MqttPublisherManager } from "./mqtt-publisher-manager.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const migrations = [
    "001_initial.sql",
    "002_mqtt_publisher_on_change_only.sql",
    "003_device_order_category.sql",
    "004_drop_dispatch_config.sql",
    "005_device_data_enum_values.sql",
    "006_pool_runtime_and_category_override.sql",
    "007_pool_water_temp_state.sql",
    "008_mqtt_publisher_mapping_enabled.sql",
  ];
  for (const file of migrations) {
    const sql = readFileSync(
      resolve(import.meta.dirname ?? ".", `../../migrations/${file}`),
      "utf-8",
    );
    db.exec(sql);
  }
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
