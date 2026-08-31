/**
 * Spec 171 — who decides whether the tile asks before it acts.
 *
 * The package proposes, the instance disposes: these pin that order, and that
 * "the user never answered" is a distinct case from "the user said no".
 */

import { describe, it, expect } from "vitest";
import { tileNeedsConfirm } from "./recipe-tile-confirm";

describe("tileNeedsConfirm", () => {
  it("asks nothing when the recipe declared nothing", () => {
    expect(tileNeedsConfirm({}, {})).toBe(false);
    expect(tileNeedsConfirm({ icon: "Truck" }, undefined)).toBe(false);
  });

  it("follows the package declaration when no parameter is named", () => {
    expect(tileNeedsConfirm({ confirm: true }, { whatever: false })).toBe(true);
  });

  it("lets the instance parameter overrule the declaration, both ways", () => {
    const tile = { confirm: true, confirmParam: "confirmFromDashboard" };
    expect(tileNeedsConfirm(tile, { confirmFromDashboard: false })).toBe(false);
    expect(tileNeedsConfirm({ confirmParam: "confirmFromDashboard" }, { confirmFromDashboard: true })).toBe(true);
  });

  it("reads a stringified boolean, as a hand-written param may carry", () => {
    const tile = { confirm: false, confirmParam: "ask" };
    expect(tileNeedsConfirm(tile, { ask: "true" })).toBe(true);
    expect(tileNeedsConfirm({ confirm: true, confirmParam: "ask" }, { ask: "false" })).toBe(false);
  });

  it("falls back to the declaration when the user never answered", () => {
    const tile = { confirm: true, confirmParam: "ask" };
    // An instance created before the recipe grew the slot carries no value —
    // that is not a "no", and a gate must not lose its guard to an upgrade.
    expect(tileNeedsConfirm(tile, {})).toBe(true);
    expect(tileNeedsConfirm(tile, { ask: null })).toBe(true);
    expect(tileNeedsConfirm(tile, { ask: "" })).toBe(true);
  });
});
