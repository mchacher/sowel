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

  it("streaming 'power' beyond 2 min window is stale on a metering equipment", () => {
    expect(
      isStaleBinding("power", "2026-05-26 09:57:00Z", NOW, "number", "main_energy_meter"),
    ).toBe(true);
  });

  it("streaming 'temperature' is stale past the 65 min window", () => {
    expect(isStaleBinding("temperature", "2026-05-26 08:54:00Z", NOW)).toBe(true);
  });

  it("streaming 'temperature' is not stale at 16 min — a Zigbee sensor may stay silent for an hour", () => {
    expect(isStaleBinding("temperature", "2026-05-26 09:44:00Z", NOW)).toBe(false);
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

  it("boolean 'power' (on/off state) is never stale, even far beyond the window (#422)", () => {
    // PAC / TV pattern: a discrete on/off state that legitimately does not
    // change between polls. Would be stale as a numeric read (2 min window).
    expect(isStaleBinding("power", "2026-04-19 00:00:00Z", NOW, "boolean")).toBe(false);
    expect(isStaleBinding("power", "2026-05-26 09:57:00Z", NOW, "boolean")).toBe(false);
  });

  it("numeric 'power' beyond the window is still stale on a meter (live clamp regression guard)", () => {
    expect(
      isStaleBinding("power", "2026-05-26 09:57:00Z", NOW, "number", "main_energy_meter"),
    ).toBe(true);
  });

  it("the same stale 'power' on a switch is not stale — metering plug bound to a non-meter", () => {
    // A metering smart plug reports power on change: a steady load simply stops
    // producing updates, and that says nothing about the switch being healthy.
    expect(isStaleBinding("power", "2026-05-26 09:57:00Z", NOW, "number", "switch")).toBe(false);
    expect(isStaleBinding("current", "2026-05-26 09:00:00Z", NOW, "number", "light_onoff")).toBe(
      false,
    );
    expect(isStaleBinding("energy", "2026-05-26 09:00:00Z", NOW, "number", "water_heater")).toBe(
      false,
    );
  });

  it("an equipment type left undefined does not get the electrical window", () => {
    expect(isStaleBinding("power", "2026-05-26 09:57:00Z", NOW, "number")).toBe(false);
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
    const result = deriveEquipmentStatus([binding], map, NOW, "main_energy_meter");
    expect(result.status).toBe("degraded");
    expect(result.reason?.staleBindings).toEqual(["power"]);
    expect(result.reason?.offlineDevices).toEqual([]);
  });

  it("boolean 'power' stale by time on an online device stays 'online', not degraded (#422)", () => {
    // PAC / TV: the on/off state has not changed for a long time, but the
    // device is online and polling. A steady discrete state must not degrade.
    const binding = makeBinding({
      category: "power",
      type: "boolean",
      value: true,
      lastUpdated: "2026-04-19 00:00:00Z", // weeks old
      alias: "power",
    });
    const device = makeDevice({ status: "online" });
    const map = new Map([[binding.id, device]]);
    const result = deriveEquipmentStatus([binding], map, NOW);
    expect(result.status).toBe("online");
    expect(result.reason).toBeNull();
  });

  it("stale boolean 'power' alongside fresh bindings on an online device stays 'online' (#422)", () => {
    // PAC evidence: boolean power (stale) + temperature/setpoint fresh at the
    // same online device. The stale boolean must not tip the equipment.
    const power = makeBinding({
      id: "b-power",
      category: "power",
      type: "boolean",
      value: false,
      lastUpdated: "2026-04-19 00:00:00Z",
      alias: "power",
    });
    const temperature = makeBinding({
      id: "b-temp",
      category: "temperature",
      type: "number",
      value: 21,
      lastUpdated: "2026-05-26 09:59:00Z",
      alias: "temperature",
    });
    const device = makeDevice({ status: "online" });
    const map = new Map([
      [power.id, device],
      [temperature.id, device],
    ]);
    const result = deriveEquipmentStatus([power, temperature], map, NOW);
    expect(result.status).toBe("online");
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
    const result = deriveEquipmentStatus([binding], map, NOW, "main_energy_meter");
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
    const result = deriveEquipmentStatus([b1, b2], map, NOW, "main_energy_meter");
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

// ─── metering plug bound to a non-metering equipment ────────────────────

describe("electrical bindings on a non-metering equipment", () => {
  /** A Zigbee metering plug: on/off state plus the electrical extras. */
  const meteringPlug = (powerLastUpdated: string) => {
    const state = makeBinding({
      id: "b-state",
      category: "light_state",
      type: "boolean",
      value: true,
      alias: "state",
      lastUpdated: "2026-05-26 09:59:50Z",
    });
    const power = makeBinding({
      id: "b-power",
      category: "power",
      type: "number",
      value: 0,
      alias: "power",
      lastUpdated: powerLastUpdated,
    });
    const device = makeDevice({ status: "online" });
    return {
      bindings: [state, power],
      map: new Map([
        [state.id, device],
        [power.id, device],
      ]),
    };
  };

  it("stays online when the plug has not reported power for an hour", () => {
    // The load is steady, so the plug has nothing to report. Before this, the
    // equipment flipped to degraded 2 min after every report and back on the
    // next one — 180 status transitions in an hour on a healthy install.
    const { bindings, map } = meteringPlug("2026-05-26 09:00:00Z");
    expect(deriveEquipmentStatus(bindings, map, NOW, "switch").status).toBe("online");
    expect(deriveEquipmentStatus(bindings, map, NOW, "light_onoff").status).toBe("online");
  });

  it("still degrades when the device itself is reported offline", () => {
    // device.status stays the authoritative health signal for these types.
    const { bindings, map } = meteringPlug("2026-05-26 09:59:50Z");
    for (const [, device] of map) device.status = "offline";
    expect(deriveEquipmentStatus(bindings, map, NOW, "switch").status).toBe("offline");
  });

  it("the same silence on a meter is still degraded", () => {
    const { bindings, map } = meteringPlug("2026-05-26 09:00:00Z");
    const result = deriveEquipmentStatus(bindings, map, NOW, "main_energy_meter");
    expect(result.status).toBe("degraded");
    expect(result.reason?.staleBindings).toEqual(["power"]);
  });

  it("a non-electrical streaming binding still degrades any equipment type", () => {
    const temperature = makeBinding({
      id: "b-temp",
      category: "temperature",
      type: "number",
      value: 19,
      alias: "temperature",
      lastUpdated: "2026-05-26 08:00:00Z", // 2 h — beyond the 65 min window
    });
    const device = makeDevice({ status: "online" });
    const map = new Map([[temperature.id, device]]);
    const result = deriveEquipmentStatus([temperature], map, NOW, "sensor");
    expect(result.status).toBe("degraded");
    expect(result.reason?.staleBindings).toEqual(["temperature"]);
  });
});
