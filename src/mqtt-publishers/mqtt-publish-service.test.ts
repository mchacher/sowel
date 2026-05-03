import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import { MqttBrokerManager } from "./mqtt-broker-manager.js";
import { MqttPublisherManager } from "./mqtt-publisher-manager.js";

// Fake MQTT client with a connect-then-publish surface.
const fakeClient = {
  connected: true,
  on: vi.fn(),
  publish: vi.fn(
    (_topic: string, _payload: string, _opts: unknown, cb?: (err: Error | null) => void) => {
      cb?.(null);
    },
  ),
  endAsync: vi.fn().mockResolvedValue(undefined),
  end: vi.fn(),
};

vi.mock("mqtt", () => ({
  default: {
    connect: () => {
      // Reset publish mock between tests by binding to the same fakeClient across the suite.
      return fakeClient;
    },
  },
}));

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

describe("MqttPublishService — disabled mappings are skipped", () => {
  let db: Database.Database;
  let eventBus: EventBus;
  let brokerManager: MqttBrokerManager;
  let publisherManager: MqttPublisherManager;
  let publisherId: string;
  let brokerId: string;

  // Stub managers — mqtt-publish-service consumes only a small surface
  const equipmentManager = {
    getDataBindingsWithValues: vi.fn(() => [{ alias: "temperature", value: 21 }]),
  } as unknown as import("../equipments/equipment-manager.js").EquipmentManager;

  const zoneAggregator = {
    getAll: vi.fn(() => ({})),
  } as unknown as import("../zones/zone-aggregator.js").ZoneAggregator;

  const recipeManager = {
    getInstanceState: vi.fn(() => ({})),
  } as unknown as import("../recipes/engine/recipe-manager.js").RecipeManager;

  beforeEach(async () => {
    fakeClient.publish.mockClear();
    db = createTestDb();
    eventBus = new EventBus(logger);
    brokerManager = new MqttBrokerManager(db, eventBus, logger);
    publisherManager = new MqttPublisherManager(db, eventBus, logger);

    const broker = brokerManager.create({
      name: "B",
      url: "mqtt://x",
      username: null,
      password: null,
    });
    brokerId = broker.id;
    const pub = publisherManager.create({
      name: "P",
      brokerId,
      topic: "sowel/test",
    });
    publisherId = pub.id;
  });

  async function buildService() {
    const { MqttPublishService } = await import("./mqtt-publish-service.js");
    const service = new MqttPublishService(
      eventBus,
      brokerManager,
      publisherManager,
      equipmentManager,
      zoneAggregator,
      recipeManager,
      logger,
    );
    service.init();
    return service;
  }

  it("live equipment data: enabled mapping → publish; disabled mapping → no publish", async () => {
    publisherManager.addMapping(publisherId, {
      publishKey: "Tlive",
      sourceType: "equipment",
      sourceId: "eq-A",
      sourceKey: "temperature",
    });
    publisherManager.addMapping(publisherId, {
      publishKey: "Toff",
      sourceType: "equipment",
      sourceId: "eq-B",
      sourceKey: "temperature",
      enabled: false,
    });
    const service = await buildService();
    fakeClient.publish.mockClear();

    eventBus.emit({
      type: "equipment.data.changed",
      equipmentId: "eq-A",
      alias: "temperature",
      value: 22,
    });
    eventBus.emit({
      type: "equipment.data.changed",
      equipmentId: "eq-B",
      alias: "temperature",
      value: 99,
    });

    const calls = fakeClient.publish.mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][1]).toBe(JSON.stringify({ Tlive: 22 }));

    await service.destroy();
  });

  it("publishSnapshotForPublisher skips disabled mappings", async () => {
    publisherManager.addMapping(publisherId, {
      publishKey: "Tlive",
      sourceType: "equipment",
      sourceId: "eq-A",
      sourceKey: "temperature",
    });
    publisherManager.addMapping(publisherId, {
      publishKey: "Toff",
      sourceType: "equipment",
      sourceId: "eq-A",
      sourceKey: "temperature",
      enabled: false,
    });
    const service = await buildService();
    fakeClient.publish.mockClear();

    const count = service.publishSnapshotForPublisher(publisherId);

    expect(count).toBe(1);
    expect(fakeClient.publish.mock.calls.length).toBe(1);
    expect(fakeClient.publish.mock.calls[0][1]).toBe(JSON.stringify({ Tlive: 21 }));

    await service.destroy();
  });

  it("initial snapshot only fires for enabled mappings", async () => {
    publisherManager.addMapping(publisherId, {
      publishKey: "Tlive",
      sourceType: "equipment",
      sourceId: "eq-A",
      sourceKey: "temperature",
    });
    publisherManager.addMapping(publisherId, {
      publishKey: "Toff",
      sourceType: "equipment",
      sourceId: "eq-A",
      sourceKey: "temperature",
      enabled: false,
    });
    const service = await buildService();
    // init() ran the initial snapshot once already; just inspect the result.
    const tliveCalls = fakeClient.publish.mock.calls.filter(
      (c) => typeof c[1] === "string" && (c[1] as string).includes("Tlive"),
    );
    const toffCalls = fakeClient.publish.mock.calls.filter(
      (c) => typeof c[1] === "string" && (c[1] as string).includes("Toff"),
    );
    expect(tliveCalls.length).toBeGreaterThan(0);
    expect(toffCalls.length).toBe(0);

    await service.destroy();
  });
});
