import { describe, it, expect } from "vitest";
import { EventBus } from "./event-bus.js";
import { createLogger } from "./logger.js";
import type { EngineEvent } from "../shared/types.js";

const logger = createLogger("silent").logger;

describe("EventBus", () => {
  it("emits events to handlers", () => {
    const bus = new EventBus(logger);
    const received: EngineEvent[] = [];
    bus.on((event) => received.push(event));

    bus.emit({ type: "system.started" });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("system.started");
  });

  it("supports multiple handlers", () => {
    const bus = new EventBus(logger);
    let count = 0;
    bus.on(() => count++);
    bus.on(() => count++);

    bus.emit({ type: "system.started" });

    expect(count).toBe(2);
  });

  it("onType filters by event type", () => {
    // The types here used to be `system.mqtt.connected` / `.disconnected`,
    // which no longer exist in EngineEvent and could never be emitted, so the
    // filter was being exercised against something the engine cannot produce.
    // Invisible while test files were excluded from the typecheck (#834).
    const bus = new EventBus(logger);
    const received: EngineEvent[] = [];

    bus.onType("system.integration.connected", (event) => received.push(event));

    bus.emit({ type: "system.started" });
    bus.emit({ type: "system.integration.connected", integrationId: "z2m" });
    bus.emit({ type: "system.integration.disconnected", integrationId: "z2m" });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("system.integration.connected");
  });

  it("catches handler errors without crashing", () => {
    const bus = new EventBus(logger);
    const received: EngineEvent[] = [];

    bus.on(() => {
      throw new Error("Handler error");
    });
    bus.on((event) => received.push(event));

    // Should not throw
    bus.emit({ type: "system.started" });

    // Second handler still receives the event
    expect(received).toHaveLength(1);
  });

  it("handles device.data.updated events with all fields", () => {
    const bus = new EventBus(logger);
    const received: EngineEvent[] = [];
    bus.onType("device.data.updated", (event) => received.push(event));

    bus.emit({
      type: "device.data.updated",
      deviceId: "abc",
      deviceName: "salon_pir",
      dataId: "def",
      key: "temperature",
      value: 21.5,
      previous: 21.3,
      timestamp: "2026-01-01T00:00:00Z",
    });

    expect(received).toHaveLength(1);
    if (received[0].type === "device.data.updated") {
      expect(received[0].deviceName).toBe("salon_pir");
      expect(received[0].value).toBe(21.5);
    }
  });
});
