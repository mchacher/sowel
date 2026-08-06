/**
 * Equipment availability derivation (spec 116).
 *
 * Pure functions, no I/O. Called from EquipmentManager.getByIdWithDetails /
 * getAllWithDetails to annotate each EquipmentWithDetails with a derived
 * `status` field, and from EquipmentStatusTracker to emit transition events.
 */

import {
  STREAMING_CATEGORIES,
  STREAMING_TIMEOUT_MS,
  DEFAULT_STREAMING_TIMEOUT_MS,
} from "../shared/constants.js";
import type {
  DataBindingWithValue,
  DataCategory,
  Device,
  EquipmentStatus,
  EquipmentStatusReason,
} from "../shared/types.js";

/**
 * Parse a SQLite-style ISO timestamp ("YYYY-MM-DD HH:MM:SSZ" or strict ISO 8601)
 * to epoch milliseconds. Returns null for null inputs or unparseable values.
 */
function parseTimestamp(iso: string | null): number | null {
  if (!iso) return null;
  // SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" without timezone — treat as UTC.
  const normalized = iso.includes("T")
    ? iso.replace("Z", "+00:00")
    : iso.replace(" ", "T").replace("Z", "") + "Z";
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Returns true iff the binding is on a streaming category AND its lastUpdated
 * is older than the per-category threshold. Bindings that have never received
 * a value (lastUpdated === null) are NOT stale — we never had any value to
 * begin with, so silence is expected.
 */
export function isStaleBinding(
  category: DataCategory,
  lastUpdated: string | null,
  now: number = Date.now(),
): boolean {
  if (!STREAMING_CATEGORIES.has(category)) return false;
  const updatedMs = parseTimestamp(lastUpdated);
  if (updatedMs === null) return false;
  const timeoutMs = STREAMING_TIMEOUT_MS[category] ?? DEFAULT_STREAMING_TIMEOUT_MS;
  return now - updatedMs > timeoutMs;
}

/**
 * Derive the equipment status from its bindings + the devices backing them.
 *
 * Rules (spec 116 FR3):
 *  - 0 bindings              → "offline"
 *  - all unique devices offline → "offline"
 *  - any device offline OR any streaming binding stale → "degraded"
 *  - otherwise              → "online"
 *
 * `device.status === "unknown"` counts as online (conservative — grey dot, not
 * red, in the existing Devices UI).
 *
 * @param bindings           The equipment's data bindings (already annotated).
 * @param devicesByBindingId Map from binding id to the Device behind it.
 * @param now                Injection point for tests; defaults to Date.now().
 */
/**
 * Equipment types whose devices are event-driven battery hardware (remotes,
 * wireless buttons): they only transmit when actuated, so radio silence is
 * their NORMAL operating mode. Deriving "offline" (integration availability
 * timeouts fire on silence) or "degraded" (their sparse battery reports miss
 * every streaming window) from that silence produces permanent false alarms
 * — see issue #348, observed with both lora2mqtt (5 min timeout) and
 * Zigbee2MQTT (25 h passive timeout). For these types the only honest
 * derivation from silence is "online"; real health comes out of band
 * (battery_low / vcc values).
 *
 * Trade-off, documented: a genuinely dead remote also shows online. With
 * timeout-based availability the two cases are indistinguishable anyway —
 * the previous behavior just labeled BOTH as broken instead of neither.
 */
const SILENCE_EXEMPT_EQUIPMENT_TYPES: ReadonlySet<string> = new Set(["button"]);

export function deriveEquipmentStatus(
  bindings: DataBindingWithValue[],
  devicesByBindingId: Map<string, Device>,
  now: number = Date.now(),
  equipmentType?: string,
): { status: EquipmentStatus; reason: EquipmentStatusReason | null } {
  if (bindings.length === 0) {
    return {
      status: "offline",
      reason: { offlineDevices: [], staleBindings: [], offlineSince: null },
    };
  }

  if (equipmentType && SILENCE_EXEMPT_EQUIPMENT_TYPES.has(equipmentType)) {
    return { status: "online", reason: null };
  }

  // Collect unique devices behind the bindings (an equipment can bind to
  // several devices, and each device can back several bindings).
  const uniqueDevices = new Map<string, Device>();
  for (const binding of bindings) {
    const device = devicesByBindingId.get(binding.id);
    if (device) uniqueDevices.set(device.id, device);
  }

  const offlineDevices = [...uniqueDevices.values()].filter(
    (device) => device.status === "offline",
  );
  const staleBindings = bindings.filter((binding) =>
    isStaleBinding(binding.category, binding.lastUpdated, now),
  );

  const allOffline = uniqueDevices.size > 0 && offlineDevices.length === uniqueDevices.size;
  if (allOffline) {
    return {
      status: "offline",
      reason: {
        offlineDevices: offlineDevices.map((device) => device.name),
        staleBindings: staleBindings.map((binding) => binding.alias),
        offlineSince: earliestTimestamp([
          ...offlineDevices.map((device) => device.lastSeen),
          ...staleBindings.map((binding) => binding.lastUpdated),
        ]),
      },
    };
  }

  if (offlineDevices.length > 0 || staleBindings.length > 0) {
    return {
      status: "degraded",
      reason: {
        offlineDevices: offlineDevices.map((device) => device.name),
        staleBindings: staleBindings.map((binding) => binding.alias),
        offlineSince: earliestTimestamp([
          ...offlineDevices.map((device) => device.lastSeen),
          ...staleBindings.map((binding) => binding.lastUpdated),
        ]),
      },
    };
  }

  return { status: "online", reason: null };
}

function earliestTimestamp(values: (string | null)[]): string | null {
  const valid = values.filter((v): v is string => v !== null);
  if (valid.length === 0) return null;
  return valid.reduce((min, v) => (v < min ? v : min));
}
