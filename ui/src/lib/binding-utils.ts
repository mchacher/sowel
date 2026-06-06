import type { EquipmentWithDetails } from "../types";
import type { BindingCandidate } from "./binding-candidates";

/** Build { deviceId → Set<device_order.key> } from all existing equipments.
 * Used by DeviceSelector to hide candidates whose order keys are already
 * consumed by another equipment. */
export function buildBoundOrderKeysByDevice(
  equipments: EquipmentWithDetails[],
): Record<string, Set<string>> {
  const map: Record<string, Set<string>> = {};
  for (const eq of equipments) {
    for (const ob of eq.orderBindings) {
      const s = map[ob.deviceId] ?? (map[ob.deviceId] = new Set<string>());
      s.add(ob.key);
    }
  }
  return map;
}

/** Build { deviceId → Set<device_data.key> } from all existing equipments.
 * Used by DeviceSelector to hide data-only candidates (e.g. a solar inverter
 * channel) whose channel-specific keys are already bound by another
 * equipment — so a 2-channel inverter only offers its free channel. */
export function buildBoundDataKeysByDevice(
  equipments: EquipmentWithDetails[],
): Record<string, Set<string>> {
  const map: Record<string, Set<string>> = {};
  for (const eq of equipments) {
    for (const db of eq.dataBindings) {
      const s = map[db.deviceId] ?? (map[db.deviceId] = new Set<string>());
      s.add(db.key);
    }
  }
  return map;
}

/**
 * Keep only the candidates still free, given the keys already bound on the
 * device by other equipments.
 *
 * - Order-based candidates are dropped once all their order keys are taken
 *   (e.g. a relay already used by another equipment).
 * - Pure-data candidates (e.g. a PV inverter channel) are dropped once their
 *   channel-specific data keys are all taken. Keys present in EVERY candidate
 *   are "shared" (e.g. a solar inverter's `inverter_temp`, bound by both
 *   panels) and are excluded from that test, so the second panel still shows.
 */
export function freeCandidates(
  all: BindingCandidate[],
  boundOrders?: Set<string>,
  boundData?: Set<string>,
): BindingCandidate[] {
  const sharedKeys =
    all.length > 1 ? all[0].dataKeys.filter((k) => all.every((c) => c.dataKeys.includes(k))) : [];
  return all.filter((c) => {
    const orderFree =
      c.orderKeys.length === 0 || !boundOrders || c.orderKeys.some((k) => !boundOrders.has(k));
    const ownKeys = c.dataKeys.filter((k) => !sharedKeys.includes(k));
    const dataFree =
      c.orderKeys.length > 0 ||
      !boundData ||
      ownKeys.length === 0 ||
      ownKeys.some((k) => !boundData.has(k));
    return orderFree && dataFree;
  });
}
