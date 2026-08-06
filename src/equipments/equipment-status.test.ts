import { describe, it, expect } from "vitest";
import { isStaleBinding, deriveEquipmentStatus } from "./equipment-status.js";
import type { DataBindingWithValue, Device } from "../shared/types.js";

// ─── helpers ────────────────────────────────────────────────────────────

const NOW = Date.parse("2026-05-26T10:00:00Z"); // fixed reference time

function makeDevice(overrides: Partial<Device>): Device {
  return {
    id: "dev-1",
    integrationId: "test",
    sourceDeviceId: "src-1",
    name: "Device 1",
    zoneId: null,
    source: "zigbee2mqtt",
    status: "online",
    lastSeen: "2026-05-26 09:59:50Z",
    createdAt: "2026-01-01 00:00:00Z",
    updatedAt: "2026-05-26 09:59:50Z",
    ...overrides,
  };
}

function makeBinding(overrides: Partial<DataBindingWithValue>): DataBindingWithValue {
  return {
    id: "bind-1",
    equipmentId: "eq-1",
    deviceDataId: "dd-1",
    alias: "value",
    deviceId: "dev-1",
    deviceName: "Device 1",
    key: "value",
    type: "number",
    category: "power",
    value: 42,
    lastUpdated: "2026-05-26 09:59:50Z",
    lastChanged: "2026-05-26 09:59:50Z",
    stale: false,
    ...overrides,
  };
}

// ─── isStaleBinding ─────────────────────────────────────────────────────

describe("isStaleBinding", () => {
  it("event-based category 'motion' is never stale, even very old", () => {
    expect(isStaleBinding("motion", "2025-01-01 00:00:00Z", NOW)).toBe(false);
  });

  it("event-based category 'contact_door' is never stale", () => {
    expect(isStaleBinding("contact_door", "2025-01-01 00:00:00Z", NOW)).toBe(false);
  });

  it("streaming 'power' within window (1 min ago) is not stale", () => {
    expect(isStaleBinding("power", "2026-05-26 09:59:00Z", NOW)).toBe(false);
  });

  it("streaming 'power' beyond 2 min window is stale", () => {
    expect(isStaleBinding("power", "2026-05-26 09:57:00Z", NOW)).toBe(true);
  });

  it("streaming 'temperature' is stale at 16 min (timeout is 15 min)", () => {
    expect(isStaleBinding("temperature", "2026-05-26 09:44:00Z", NOW)).toBe(true);
  });

  it("streaming 'temperature' is not stale at 10 min", () => {
    expect(isStaleBinding("temperature", "2026-05-26 09:50:00Z", NOW)).toBe(false);
  });

  it("streaming binding with lastUpdated === null is NOT stale (never received)", () => {
    expect(isStaleBinding("temperature", null, NOW)).toBe(false);
  });

  it("streaming 'battery' stale only after 2h (sparse reports)", () => {
    expect(isStaleBinding("battery", "2026-05-26 08:01:00Z", NOW)).toBe(false);
    expect(isStaleBinding("battery", "2026-05-26 07:59:00Z", NOW)).toBe(true);
  });

  it("unparseable timestamp is treated as no value — not stale", () => {
    expect(isStaleBinding("power", "not-a-date", NOW)).toBe(false);
  });
});

// ─── deriveEquipmentStatus ──────────────────────────────────────────────

describe("deriveEquipmentStatus", () => {
  it("returns 'offline' when there are no bindings at all", () => {
    const result = deriveEquipmentStatus([], new Map(), NOW);
    expect(result.status).toBe("offline");
    expect(result.reason).toEqual({
      offlineDevices: [],
      staleBindings: [],
      offlineSince: null,
    });
  });

  it("returns 'online' for 1 binding on an online device with fresh value", () => {
    const binding = makeBinding({ category: "power", lastUpdated: "2026-05-26 09:59:30Z" });
    const device = makeDevice({ status: "online" });
    const map = new Map([[binding.id, device]]);
    const result = deriveEquipmentStatus([binding], map, NOW);
    expect(result.status).toBe("online");
    expect(result.reason).toBeNull();
  });

  it("returns 'offline' when the single backing device is offline", () => {
    const binding = makeBinding({});
    const device = makeDevice({ status: "offline", name: "Compteur Shelly" });
    const map = new Map([[binding.id, device]]);
    const result = deriveEquipmentStatus([binding], map, NOW);
    expect(result.status).toBe("offline");
    expect(result.reason?.offlineDevices).toEqual(["Compteur Shelly"]);
  });

  it("returns 'degraded' when 1 device of 2 is offline", () => {
    const b1 = makeBinding({ id: "b1", deviceId: "d1" });
    const b2 = makeBinding({ id: "b2", deviceId: "d2", alias: "other" });
    const d1 = makeDevice({ id: "d1", name: "Device One", status: "online" });
    const d2 = makeDevice({ id: "d2", name: "Device Two", status: "offline" });
    const map = new Map([
      [b1.id, d1],
      [b2.id, d2],
    ]);
    const result = deriveEquipmentStatus([b1, b2], map, NOW);
    expect(result.status).toBe("degraded");
    expect(result.reason?.offlineDevices).toEqual(["Device Two"]);
  });

  it("returns 'offline' when ALL backing devices are offline", () => {
    const b1 = makeBinding({ id: "b1", deviceId: "d1" });
    const b2 = makeBinding({ id: "b2", deviceId: "d2", alias: "other" });
    const d1 = makeDevice({ id: "d1", name: "One", status: "offline" });
    const d2 = makeDevice({ id: "d2", name: "Two", status: "offline" });
    const map = new Map([
      [b1.id, d1],
      [b2.id, d2],
    ]);
    const result = deriveEquipmentStatus([b1, b2], map, NOW);
    expect(result.status).toBe("offline");
    expect(result.reason?.offlineDevices).toEqual(["One", "Two"]);
  });

  it("returns 'degraded' when device is online but a streaming binding is stale", () => {
    const binding = makeBinding({
      category: "power",
      lastUpdated: "2026-05-26 09:50:00Z",
      alias: "power",
    });
    const device = makeDevice({ status: "online" });
    const map = new Map([[binding.id, device]]);
    const result = deriveEquipmentStatus([binding], map, NOW);
    expect(result.status).toBe("degraded");
    expect(result.reason?.staleBindings).toEqual(["power"]);
    expect(result.reason?.offlineDevices).toEqual([]);
  });

  it("device 'unknown' is treated as online — no degradation alone", () => {
    const binding = makeBinding({ category: "power", lastUpdated: "2026-05-26 09:59:30Z" });
    const device = makeDevice({ status: "unknown" });
    const map = new Map([[binding.id, device]]);
    const result = deriveEquipmentStatus([binding], map, NOW);
    expect(result.status).toBe("online");
  });

  it("device 'unknown' + stale streaming binding → still degraded due to staleness", () => {
    const binding = makeBinding({ category: "power", lastUpdated: "2026-05-26 09:50:00Z" });
    const device = makeDevice({ status: "unknown" });
    const map = new Map([[binding.id, device]]);
    const result = deriveEquipmentStatus([binding], map, NOW);
    expect(result.status).toBe("degraded");
  });

  it("offlineSince is the earliest of all offending timestamps", () => {
    const b1 = makeBinding({
      id: "b1",
      deviceId: "d1",
      category: "power",
      lastUpdated: "2026-05-26 09:30:00Z", // stale (30 min ago)
      alias: "power",
    });
    const b2 = makeBinding({
      id: "b2",
      deviceId: "d2",
      alias: "other",
    });
    const d1 = makeDevice({ id: "d1", name: "One", status: "online" });
    const d2 = makeDevice({
      id: "d2",
      name: "Two",
      status: "offline",
      lastSeen: "2026-05-26 09:45:00Z", // more recent than stale b1
    });
    const map = new Map([
      [b1.id, d1],
      [b2.id, d2],
    ]);
    const result = deriveEquipmentStatus([b1, b2], map, NOW);
    expect(result.status).toBe("degraded");
    // Earliest of "09:30:00" and "09:45:00" → "09:30:00"
    expect(result.reason?.offlineSince).toBe("2026-05-26 09:30:00Z");
  });

  it("motion binding stale (would-be 21 days) does NOT trigger degradation", () => {
    const binding = makeBinding({
      category: "motion",
      lastUpdated: "2026-05-05 10:00:00Z",
      alias: "occupancy",
      value: false,
    });
    const device = makeDevice({ status: "online" });
    const map = new Map([[binding.id, device]]);
    const result = deriveEquipmentStatus([binding], map, NOW);
    expect(result.status).toBe("online");
  });
});

describe("deriveEquipmentStatus — button silence exemption (issue #348)", () => {
  const NOW = Date.parse("2026-05-26T10:00:00Z");

  it("button: all devices offline still derives 'online' (silence is normal)", () => {
    const binding = makeBinding({ category: "action" });
    const device = makeDevice({ status: "offline", name: "remote_elodie" });
    const map = new Map([[binding.id, device]]);
    const result = deriveEquipmentStatus([binding], map, NOW, "button");
    expect(result.status).toBe("online");
    expect(result.reason).toBeNull();
  });

  it("button: stale battery binding does not degrade", () => {
    const action = makeBinding({ id: "b1", category: "action" });
    const battery = makeBinding({
      id: "b2",
      alias: "battery",
      category: "battery",
      lastUpdated: "2026-05-25 08:00:00Z", // > 2h old
    });
    const device = makeDevice({ status: "online" });
    const map = new Map([
      [action.id, device],
      [battery.id, device],
    ]);
    const result = deriveEquipmentStatus([action, battery], map, NOW, "button");
    expect(result.status).toBe("online");
  });

  it("button: zero bindings still derives 'offline'", () => {
    const result = deriveEquipmentStatus([], new Map(), NOW, "button");
    expect(result.status).toBe("offline");
  });

  it("non-exempt type: all devices offline still derives 'offline' (regression)", () => {
    const binding = makeBinding({});
    const device = makeDevice({ status: "offline", name: "Capteur" });
    const map = new Map([[binding.id, device]]);
    const result = deriveEquipmentStatus([binding], map, NOW, "sensor");
    expect(result.status).toBe("offline");
  });
});
