import { describe, it, expect } from "vitest";
import {
  formatRuntime,
  isOnBattery,
  upsSeverityOf,
  upsStatusKey,
  upsStatusOf,
} from "./upsStatus";
import type { EquipmentWithDetails } from "../../types";

function equipmentWith(bindings: { alias: string; category?: string; value?: unknown }[]) {
  return { dataBindings: bindings } as unknown as EquipmentWithDetails;
}

describe("upsStatusOf", () => {
  it("reads the status by category, whatever the plugin named the key", () => {
    const eq = equipmentWith([{ alias: "etat", category: "ups_status", value: "on_battery" }]);
    expect(upsStatusOf(eq)).toEqual({ status: "on_battery", raw: "on_battery" });
  });

  it("falls back to a conventional alias when the category is missing", () => {
    const eq = equipmentWith([{ alias: "status", value: "online" }]);
    expect(upsStatusOf(eq).status).toBe("online");
  });

  it("keeps an unknown value as raw rather than dropping it", () => {
    const eq = equipmentWith([{ alias: "status", category: "ups_status", value: "CAL" }]);
    expect(upsStatusOf(eq)).toEqual({ status: null, raw: "CAL" });
  });

  it("returns nothing when the UPS reports no status at all", () => {
    expect(upsStatusOf(equipmentWith([]))).toEqual({ status: null, raw: null });
    const empty = equipmentWith([{ alias: "status", category: "ups_status", value: "" }]);
    expect(upsStatusOf(empty)).toEqual({ status: null, raw: null });
  });
});

describe("upsSeverityOf", () => {
  it("maps each status to how loudly it should render", () => {
    expect(upsSeverityOf("online")).toBe("ok");
    expect(upsSeverityOf("on_battery")).toBe("warning");
    expect(upsSeverityOf("bypass")).toBe("warning");
    expect(upsSeverityOf("overload")).toBe("error");
    expect(upsSeverityOf("low_battery")).toBe("error");
    expect(upsSeverityOf("offline")).toBe("error");
  });

  it("renders an unrecognized status neutrally instead of alarming", () => {
    expect(upsSeverityOf(null)).toBe("unknown");
  });
});

describe("upsStatusKey", () => {
  it("keys off the status, with an explicit unknown label", () => {
    expect(upsStatusKey("low_battery")).toBe("equipments.ups.status.low_battery");
    expect(upsStatusKey(null)).toBe("equipments.ups.status.unknown");
  });
});

describe("isOnBattery", () => {
  it("is true only when the mains is gone", () => {
    expect(isOnBattery("on_battery")).toBe(true);
    expect(isOnBattery("low_battery")).toBe(true);
    expect(isOnBattery("online")).toBe(false);
    expect(isOnBattery("bypass")).toBe(false);
    expect(isOnBattery(null)).toBe(false);
  });
});

describe("formatRuntime", () => {
  it("keeps seconds in the range where they matter", () => {
    expect(formatRuntime(0)).toBe("0 s");
    expect(formatRuntime(45)).toBe("45 s");
    expect(formatRuntime(59)).toBe("59 s");
  });

  it("switches to minutes below the hour", () => {
    expect(formatRuntime(60)).toBe("1 min");
    expect(formatRuntime(3599)).toBe("59 min");
  });

  it("switches to hours above, zero-padding the minutes", () => {
    expect(formatRuntime(3600)).toBe("1 h");
    expect(formatRuntime(3912)).toBe("1 h 05");
    expect(formatRuntime(7800)).toBe("2 h 10");
  });

  it("accepts a numeric string, since bound values are untyped", () => {
    expect(formatRuntime("3312")).toBe("55 min");
  });

  it("returns nothing for a value that is not a duration", () => {
    expect(formatRuntime(undefined)).toBeNull();
    expect(formatRuntime(null)).toBeNull();
    expect(formatRuntime("n/a")).toBeNull();
    expect(formatRuntime(-1)).toBeNull();
  });
});
