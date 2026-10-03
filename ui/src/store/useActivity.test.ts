import { describe, expect, it } from "vitest";
import { coalesce } from "./useActivity";
import type { ActivityItem } from "../types";

const order = (name: string, ts: number): ActivityItem =>
  ({
    id: `${name}-${ts}`,
    timestamp: ts,
    category: "order",
    zoneId: "z",
    message: {
      template: "order.executed",
      params: { equipmentName: name, alias: "wake", value: "ON", momentary: "ev_wake" },
    },
  }) as ActivityItem;

describe("coalesce", () => {
  it("keeps the momentary flag when merging orders", () => {
    const merged = coalesce(order("Rafale", 1000), order("Megane", 1200));
    expect(merged?.message).toMatchObject({
      template: "order.executed.multi",
      params: { count: 2, momentary: "ev_wake" },
    });
  });
});
