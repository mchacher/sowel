/**
 * Spec 174 phase 2 — the one countdown both surfaces render.
 *
 * The case worth pinning is a tab that slept: the component must read the
 * engine's deadline on every tick rather than count down from a number captured
 * at mount, or a phone coming out of a pocket shows a window that expired ten
 * minutes ago as if it were still running.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "../../test-utils";
import { TimedCountdown } from "./TimedCountdown";
import { formatRemaining, remainingMs, elapsedFraction } from "../../lib/timed-countdown";
import type { TimedAction } from "../../types";

const NOW = Date.parse("2026-09-01T12:00:00Z");

function window_(armedMinAgo: number, expiresInMin: number): TimedAction {
  return {
    alias: "command",
    value: null,
    revertValue: null,
    armedAt: new Date(NOW - armedMinAgo * 60_000).toISOString(),
    expiresAt: new Date(NOW + expiresInMin * 60_000).toISOString(),
  };
}

describe("formatRemaining", () => {
  it("is m:ss under an hour and h:mm:ss above it", () => {
    expect(formatRemaining(642_000)).toBe("10:42");
    expect(formatRemaining(9_000)).toBe("0:09");
    expect(formatRemaining(2 * 3_600_000 + 5 * 60_000 + 3_000)).toBe("2:05:03");
  });
});

describe("remainingMs", () => {
  it("floors at zero rather than counting backwards", () => {
    expect(remainingMs(new Date(NOW - 60_000).toISOString(), NOW)).toBe(0);
  });

  it("reads an unparseable deadline as nothing left, never as forever", () => {
    expect(remainingMs("not a date", NOW)).toBe(0);
  });
});

describe("elapsedFraction", () => {
  it("is the share of the window already spent", () => {
    expect(elapsedFraction(window_(5, 15), NOW)).toBeCloseTo(0.25, 5);
  });

  it("is complete for a window whose bounds make no sense", () => {
    const broken = { ...window_(5, 15), armedAt: "nope" };
    expect(elapsedFraction(broken, NOW)).toBe(1);
  });
});

describe("TimedCountdown", () => {
  it("renders the time the engine still owes", () => {
    render(<TimedCountdown action={window_(5, 10)} now={NOW} />);
    expect(screen.getByText("10:00")).toBeTruthy();
  });

  it("renders 0:00 for a deadline that passed while the tab slept", () => {
    render(<TimedCountdown action={window_(30, -10)} now={NOW} />);
    expect(screen.getByText("0:00")).toBeTruthy();
  });
});
