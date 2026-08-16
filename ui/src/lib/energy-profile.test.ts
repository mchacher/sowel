import { describe, it, expect } from "vitest";
import { minutesToSeconds, secondsToMinutes } from "./energy-profile";

// Issue #546 — the energy profile form edits minOn/minOff in minutes while
// storage stays in seconds. The conversion pair must round-trip the values
// users actually see.
describe("energy profile minutes/seconds conversion", () => {
  it("converts whole minutes both ways", () => {
    expect(secondsToMinutes(3600)).toBe(60);
    expect(minutesToSeconds(60)).toBe(3600);
    expect(secondsToMinutes(900)).toBe(15);
    expect(minutesToSeconds(15)).toBe(900);
    expect(secondsToMinutes(0)).toBe(0);
    expect(minutesToSeconds(0)).toBe(0);
  });

  it("displays legacy non-multiple-of-60 values with one decimal and round-trips them", () => {
    expect(secondsToMinutes(90)).toBe(1.5);
    expect(minutesToSeconds(1.5)).toBe(90);
    expect(minutesToSeconds(secondsToMinutes(90))).toBe(90);
  });

  it("accepts decimal minutes typed by the user", () => {
    expect(minutesToSeconds(0.5)).toBe(30);
    expect(secondsToMinutes(30)).toBe(0.5);
    expect(minutesToSeconds(2.5)).toBe(150);
  });

  it("pins the 0.1 min display granularity for non-representable second values", () => {
    // 6 s resolution: values between decimals round half-up on display; the
    // stored seconds only change if the user actually retypes the field.
    expect(secondsToMinutes(100)).toBe(1.7);
    expect(secondsToMinutes(75)).toBe(1.3);
    expect(minutesToSeconds(1.7)).toBe(102);
  });

  it("round-trips every default timing used by the form", () => {
    for (const s of [300, 600, 900, 1800, 3600]) {
      expect(minutesToSeconds(secondsToMinutes(s))).toBe(s);
    }
  });
});
