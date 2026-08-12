import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import { applyMigrations } from "../test-helpers/migrations.js";
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
    // Reset publish mock between tests by binding to the same fakeClient across the suite.
    connect: vi.fn(() => fakeClient),
  },
}));

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
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

// Issue #399 — deterministic clientId collided across instances sharing a DB copy.
describe("MqttPublishService — clientId uniqueness and reconnect log throttling", () => {
  let db: Database.Database;
  let eventBus: EventBus;
  let brokerManager: MqttBrokerManager;
  let publisherManager: MqttPublisherManager;
  let brokerId: string;

  const equipmentManager = {
    getDataBindingsWithValues: vi.fn(() => []),
  } as unknown as import("../equipments/equipment-manager.js").EquipmentManager;
  const zoneAggregator = {
    getAll: vi.fn(() => ({})),
  } as unknown as import("../zones/zone-aggregator.js").ZoneAggregator;
  const recipeManager = {
    getInstanceState: vi.fn(() => ({})),
  } as unknown as import("../recipes/engine/recipe-manager.js").RecipeManager;

  function makeSpyLogger() {
    const spy = {
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
      child: vi.fn(),
    };
    spy.child.mockReturnValue(spy);
    return spy;
  }

  beforeEach(async () => {
    const mqttMod = (await import("mqtt")).default;
    vi.mocked(mqttMod.connect).mockClear();
    fakeClient.on.mockClear();
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
  });

  async function buildService(spyLogger: ReturnType<typeof makeSpyLogger>) {
    const { MqttPublishService } = await import("./mqtt-publish-service.js");
    const service = new MqttPublishService(
      eventBus,
      brokerManager,
      publisherManager,
      equipmentManager,
      zoneAggregator,
      recipeManager,
      spyLogger as unknown as ReturnType<typeof createLogger>["logger"],
    );
    service.init();
    return service;
  }

  it("generates a unique clientId per connection, prefixed by the broker id", async () => {
    const mqttMod = (await import("mqtt")).default;
    const serviceA = await buildService(makeSpyLogger());
    const serviceB = await buildService(makeSpyLogger());

    const calls = vi.mocked(mqttMod.connect).mock.calls;
    expect(calls.length).toBe(2);
    const idA = (calls[0][1] as { clientId: string }).clientId;
    const idB = (calls[1][1] as { clientId: string }).clientId;
    const prefix = `sowel-publisher-${brokerId.slice(0, 8)}-`;
    expect(idA.startsWith(prefix)).toBe(true);
    expect(idB.startsWith(prefix)).toBe(true);
    expect(idA).not.toBe(idB);

    await serviceA.destroy();
    await serviceB.destroy();
  });

  it("throttles reconnect warns to one per window and counts suppressed ones", async () => {
    vi.useFakeTimers();
    try {
      const spyLogger = makeSpyLogger();
      const service = await buildService(spyLogger);

      const reconnectHandler = fakeClient.on.mock.calls
        .filter((c) => c[0] === "reconnect")
        .at(-1)?.[1] as () => void;
      expect(reconnectHandler).toBeDefined();

      for (let i = 0; i < 5; i++) reconnectHandler();
      const warns = spyLogger.warn.mock.calls.filter(
        (c) => c[1] === "MQTT publish broker reconnecting...",
      );
      expect(warns.length).toBe(1);
      expect(warns[0][0]).toMatchObject({ suppressedSinceLastLog: 0 });

      vi.advanceTimersByTime(61_000);
      reconnectHandler();
      const warnsAfter = spyLogger.warn.mock.calls.filter(
        (c) => c[1] === "MQTT publish broker reconnecting...",
      );
      expect(warnsAfter.length).toBe(2);
      expect(warnsAfter[1][0]).toMatchObject({ suppressedSinceLastLog: 4 });

      await service.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs connected at info only on first connect, debug afterwards", async () => {
    const spyLogger = makeSpyLogger();
    const service = await buildService(spyLogger);

    const connectHandler = fakeClient.on.mock.calls
      .filter((c) => c[0] === "connect")
      .at(-1)?.[1] as () => void;
    expect(connectHandler).toBeDefined();

    connectHandler();
    connectHandler();

    const infoConnected = spyLogger.info.mock.calls.filter(
      (c) => c[1] === "MQTT publish broker connected",
    );
    const debugReconnected = spyLogger.debug.mock.calls.filter(
      (c) => c[1] === "MQTT publish broker reconnected",
    );
    expect(infoConnected.length).toBe(1);
    expect(debugReconnected.length).toBe(1);

    await service.destroy();
  });
});
