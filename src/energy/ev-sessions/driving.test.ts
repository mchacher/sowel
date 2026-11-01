import { describe, expect, it } from "vitest";
import { onBattery, onCharging, onMileage } from "./driving.js";

const T = Date.UTC(2026, 10, 1, 8, 0, 0);
const H = 3_600_000;

describe("driving legs", () => {
  it("starts a leg on the first mileage reading", () => {
    const { next, leg } = onMileage(null, 23_000, 80, T);
    expect(leg).toBeNull();
    expect(next).toMatchObject({ mileageKm: 23_000, battery: 80, charged: false });
  });

  it("measures a leg with no charge on the way", () => {
    let { next } = onMileage(null, 23_000, 80, T);
    next = onBattery(next, 76);
    const { leg } = onMileage(next, 23_040, 72, T + H);
    expect(leg).toEqual({ kmTotal: 40, kmMeasured: 40, batteryDrop: 8 });
  });

  it("leaves out a leg during which the battery rose (charged elsewhere)", () => {
    let { next } = onMileage(null, 23_000, 50, T);
    next = onBattery(next, 30);
    next = onBattery(next, 60);
    const { leg } = onMileage(next, 23_060, 55, T + H);
    expect(leg).toEqual({ kmTotal: 60, kmMeasured: 0, batteryDrop: 0 });
  });

  it("leaves out a leg during which the car said it was charging", () => {
    const { next } = onMileage(null, 23_000, 50, T);
    const { leg } = onMileage(onCharging(next), 23_010, 49, T + H);
    expect(leg?.kmMeasured).toBe(0);
  });

  it("starts a fresh leg on a reading without km, so a parked charge spoils nothing", () => {
    let { next } = onMileage(null, 23_000, 30, T);
    next = onBattery(next, 80); // charged at home, parked
    next = onMileage(next, 23_000, 80, T + H).next;
    const { leg } = onMileage(next, 23_050, 70, T + 2 * H);
    expect(leg).toEqual({ kmTotal: 50, kmMeasured: 50, batteryDrop: 10 });
  });

  it("counts the km but measures nothing without a battery level", () => {
    const { next } = onMileage(null, 100, null, T);
    expect(onMileage(next, 140, null, T + H).leg).toEqual({
      kmTotal: 40,
      kmMeasured: 0,
      batteryDrop: 0,
    });
  });

  it("ignores a mileage that goes backwards, and keeps the leg", () => {
    const { next } = onMileage(null, 23_000, 50, T);
    const glitch = onMileage(next, 0, 50, T + H);
    expect(glitch.leg).toBeNull();
    expect(onMileage(glitch.next, 23_040, 45, T + 2 * H).leg).toEqual({
      kmTotal: 40,
      kmMeasured: 40,
      batteryDrop: 5,
    });
  });
});
