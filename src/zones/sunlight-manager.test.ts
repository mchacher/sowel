import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { SunlightManager } from "./sunlight-manager.js";
import { SettingsManager } from "../core/settings-manager.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import { createMigratedTestDb } from "../test-helpers/migrations.js";
import type { EngineEvent } from "../shared/types.js";

const logger = createLogger("silent").logger;

// Paris — a location where sunrise/sunset are always well-defined.
const PARIS = { lat: "48.8566", lon: "2.3522" };

describe("SunlightManager", () => {
  let db: Database.Database;
  let settings: SettingsManager;
  let eventBus: EventBus;
  let events: EngineEvent[];
  let manager: SunlightManager;

  beforeEach(() => {
    db = createMigratedTestDb();
    settings = new SettingsManager(db);
    eventBus = new EventBus(logger);
    events = [];
    eventBus.on((e) => events.push(e));
    manager = new SunlightManager(settings, eventBus, logger);
  });

  afterEach(() => {
    manager.stop(); // clear the 60s interval
    db.close();
  });

  it("leaves data null and emits nothing when no home location is configured", () => {
    manager.start();
    expect(manager.getSunlightData()).toEqual({
      sunrise: null,
      sunset: null,
      isDaylight: null,
    });
    expect(events.some((e) => e.type === "sunlight.changed")).toBe(false);
  });

  it("computes formatted sunrise/sunset and a boolean isDaylight from the location", () => {
    settings.set("home.latitude", PARIS.lat);
    settings.set("home.longitude", PARIS.lon);

    manager.start();
    const data = manager.getSunlightData();

    expect(data.sunrise).toMatch(/^\d{2}:\d{2}$/);
    expect(data.sunset).toMatch(/^\d{2}:\d{2}$/);
    expect(typeof data.isDaylight).toBe("boolean");
    // Transitioning from all-null to real values emits a change.
    expect(events.filter((e) => e.type === "sunlight.changed")).toHaveLength(1);
  });

  it("treats a non-numeric latitude as no location", () => {
    settings.set("home.latitude", "not-a-number");
    settings.set("home.longitude", PARIS.lon);

    manager.start();
    expect(manager.getSunlightData().sunrise).toBeNull();
  });

  it("recomputes when a home.* setting changes, and resets to null when the location is cleared", () => {
    settings.set("home.latitude", PARIS.lat);
    settings.set("home.longitude", PARIS.lon);
    manager.start();
    expect(manager.getSunlightData().sunrise).not.toBeNull();
    const changesAfterStart = events.filter((e) => e.type === "sunlight.changed").length;

    // Clear the location, then signal a home settings change.
    db.prepare("DELETE FROM settings WHERE key = ?").run("home.latitude");
    eventBus.emit({ type: "settings.changed", keys: ["home.latitude"] });

    expect(manager.getSunlightData()).toEqual({
      sunrise: null,
      sunset: null,
      isDaylight: null,
    });
    // The reset (non-null → null) emits another sunlight.changed.
    expect(events.filter((e) => e.type === "sunlight.changed").length).toBe(changesAfterStart + 1);
  });

  it("ignores settings changes that are not under the home.* namespace", () => {
    settings.set("home.latitude", PARIS.lat);
    settings.set("home.longitude", PARIS.lon);
    manager.start();
    const before = events.filter((e) => e.type === "sunlight.changed").length;

    eventBus.emit({ type: "settings.changed", keys: ["integration.zigbee2mqtt.mqtt_url"] });

    // No recompute → no additional change event.
    expect(events.filter((e) => e.type === "sunlight.changed").length).toBe(before);
  });

  it("stop() is idempotent", () => {
    manager.start();
    expect(() => {
      manager.stop();
      manager.stop();
    }).not.toThrow();
  });
});
