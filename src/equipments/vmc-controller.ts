// ============================================================
// Spec 153 — VMC (2-speed ventilation) controller
//
// A VMC equipment drives up to two on/off relay orders: `low` (required, the
// petite-vitesse winding) and `high` (optional, the grande-vitesse winding).
// The user-facing state is a single speed: OFF / V1 / V2.
//
// SAFETY: every 2-speed VMC is wired so the phase reaches EITHER the low OR the
// high winding, never both — energizing both windings at once can damage the
// motor. This module is the single place that invariant is enforced: a `speed`
// order is decomposed into sequenced relay orders that are always
// break-before-make (the non-target relay is turned off before the target one
// is turned on), so at no instant are both relays commanded on.
// ============================================================

import type { ComputedDataEntry, DataBindingWithValue } from "../shared/types.js";

export type VmcSpeed = "off" | "v1" | "v2";

/** One relay command step in a speed transition. */
export interface VmcRelayStep {
  relay: "low" | "high";
  value: boolean;
}

/** Raised when V2 is requested on a VMC that has no high-speed relay bound. */
export class VmcHighSpeedUnavailableError extends Error {
  constructor() {
    super("This VMC has no high-speed relay: V2 is unavailable");
    this.name = "VmcHighSpeedUnavailableError";
  }
}

/**
 * Normalize an incoming order value to a VmcSpeed.
 * Accepts the canonical `off`/`v1`/`v2` (case-insensitive) plus the on/off and
 * numeric forms a single-speed control may send. Returns null when unknown.
 */
export function normalizeVmcSpeed(value: unknown): VmcSpeed | null {
  if (value === false || value === 0) return "off";
  if (value === true || value === 1) return "v1";
  if (value === 2) return "v2";
  if (typeof value === "string") {
    switch (value.trim().toLowerCase()) {
      case "off":
      case "0":
        return "off";
      case "v1":
      case "on":
      case "1":
      case "low":
        return "v1";
      case "v2":
      case "2":
      case "high":
        return "v2";
    }
  }
  return null;
}

/**
 * Ordered relay steps to reach `target`, break-before-make.
 *
 * The invariant proven by the tests: no prefix of the returned steps ever has
 * both relays commanded on, because a make step (`{value:true}`) is always
 * preceded by the other relay's break step (`{value:false}`).
 *
 * @throws VmcHighSpeedUnavailableError when `target` is `v2` and `hasHigh` is false.
 */
export function planSpeedTransition(target: VmcSpeed, hasHigh: boolean): VmcRelayStep[] {
  switch (target) {
    case "off":
      return hasHigh
        ? [
            { relay: "high", value: false },
            { relay: "low", value: false },
          ]
        : [{ relay: "low", value: false }];
    case "v1":
      // Break high first (in case we come from V2), then make low.
      return hasHigh
        ? [
            { relay: "high", value: false },
            { relay: "low", value: true },
          ]
        : [{ relay: "low", value: true }];
    case "v2":
      if (!hasHigh) throw new VmcHighSpeedUnavailableError();
      // Break low first, then make high.
      return [
        { relay: "low", value: false },
        { relay: "high", value: true },
      ];
  }
}

/**
 * Derive the observed speed from the relay state feedback.
 *
 * Returns null when neither relay reports state (no feedback) so the caller can
 * fall back. `bothOn` flags an out-of-spec state (both windings energized by
 * something external) — reported as V2, never produced by this module.
 */
export function deriveVmcSpeed(
  low: boolean | null,
  high: boolean | null,
): { speed: VmcSpeed; bothOn: boolean } | null {
  if (low === null && high === null) return null;
  const lowOn = low === true;
  const highOn = high === true;
  if (highOn) return { speed: "v2", bothOn: lowOn };
  if (lowOn) return { speed: "v1", bothOn: false };
  return { speed: "off", bothOn: false };
}

/** Interpret a relay state binding value as a boolean, or null when absent. */
function relayStateOf(bindings: DataBindingWithValue[], alias: string): boolean | null {
  const b = bindings.find((x) => x.alias === alias);
  if (!b || b.value === null || b.value === undefined) return null;
  const v = b.value;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v > 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "on" || s === "true" || s === "1") return true;
    if (s === "off" || s === "false" || s === "0") return false;
  }
  return null;
}

interface VmcSpeedTrackerDeps {
  getById(equipmentId: string): { type: string } | null;
  getDataBindingsWithValues(equipmentId: string): DataBindingWithValue[];
  logger: { warn(obj: Record<string, unknown>, msg: string): void };
}

/**
 * Computed-data provider: surfaces `speed` (off/v1/v2) on every `vmc` equipment,
 * derived from the observed `low`/`high` relay state bindings. Stateless: it is
 * recomputed on read, like the pool water-temp tracker.
 */
export class VmcSpeedTracker {
  constructor(private readonly deps: VmcSpeedTrackerDeps) {}

  getComputedDataForEquipment(equipmentId: string): ComputedDataEntry[] {
    const eq = this.deps.getById(equipmentId);
    if (!eq || eq.type !== "vmc") return [];

    const bindings = this.deps.getDataBindingsWithValues(equipmentId);
    const derived = deriveVmcSpeed(relayStateOf(bindings, "low"), relayStateOf(bindings, "high"));
    if (!derived) return []; // no relay state feedback — nothing to compute

    if (derived.bothOn) {
      this.deps.logger.warn(
        { equipmentId },
        "VMC has both relays energized (external): reporting V2",
      );
    }

    return [
      {
        alias: "speed",
        value: derived.speed,
        lastUpdated: null,
      },
    ];
  }
}
