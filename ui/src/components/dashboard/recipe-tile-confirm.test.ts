/**
 * Spec 171 — who decides whether the tile asks before it acts.
 *
 * The equipment first, then the instance, then the package: these pin that
 * order, and that "the user never answered" is a distinct case from "the user
 * said no".
 */

import { describe, it, expect } from "vitest";
import { tileNeedsConfirm } from "./recipe-tile-confirm";
import type { EquipmentWithDetails } from "../../types";

/** Just enough equipment for the resolver — it only reads two fields. */
function gate(requireConfirmation: boolean | undefined, id = "eq-gate"): EquipmentWithDetails {
  return {
    id,
    name: "Portail",
    type: "gate",
    zoneId: "z1",
    enabled: true,
    requireConfirmation,
    dataBindings: [],
    orderBindings: [],
    status: "online",
  } as unknown as EquipmentWithDetails;
}

const lookup =
  (...equipments: EquipmentWithDetails[]) =>
  (id: string) =>
    equipments.find((e) => e.id === id);

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

  // ── The equipment has the last word (Marc's review on #868) ──

  it("derives the guard from the equipment the recipe points at", () => {
    const tile = { confirmFrom: "gate" };
    const params = { gate: "eq-gate" };
    expect(tileNeedsConfirm(tile, params, lookup(gate(true)))).toBe(true);
    expect(tileNeedsConfirm(tile, params, lookup(gate(false)))).toBe(false);
    // Never set is spec 146's default, and its default is off.
    expect(tileNeedsConfirm(tile, params, lookup(gate(undefined)))).toBe(false);
  });

  it("lets the equipment overrule BOTH the package and the instance", () => {
    // The point of the derivation: one answer, given on the equipment. A gate
    // whose owner turned confirmation off does not get asked by a back door,
    // and one who turned it on is asked even by a recipe that declared nothing.
    const tile = { confirm: true, confirmParam: "ask", confirmFrom: "gate" };
    const params = { gate: "eq-gate", ask: true };
    expect(tileNeedsConfirm(tile, params, lookup(gate(false)))).toBe(false);
    expect(
      tileNeedsConfirm({ confirmFrom: "gate" }, { gate: "eq-gate", ask: false }, lookup(gate(true))),
    ).toBe(true);
  });

  it("falls back when there is nothing to derive from", () => {
    // Each of these is a real case, and none of them is an answer of "no":
    // a recipe that names no slot, a store that has not loaded, an equipment
    // deleted under the instance, and a slot the user has not filled in.
    const tile = { confirm: true, confirmParam: "ask", confirmFrom: "gate" };
    expect(tileNeedsConfirm({ confirm: true }, { gate: "eq-gate" }, lookup(gate(false)))).toBe(true);
    expect(tileNeedsConfirm(tile, { gate: "eq-gate" })).toBe(true);
    expect(tileNeedsConfirm(tile, { gate: "eq-gate" }, lookup())).toBe(true);
    expect(tileNeedsConfirm(tile, { gate: "" }, lookup(gate(false)))).toBe(true);
    // …and the instance still disposes on that fallback path.
    expect(tileNeedsConfirm(tile, { gate: "", ask: false }, lookup(gate(true)))).toBe(false);
  });

  it("ignores a slot whose value is not an equipment id", () => {
    const tile = { confirm: true, confirmFrom: "gate" };
    expect(tileNeedsConfirm(tile, { gate: 42 }, lookup(gate(false)))).toBe(true);
    expect(tileNeedsConfirm(tile, { gate: ["a", "b"] }, lookup(gate(false)))).toBe(true);
  });
});
