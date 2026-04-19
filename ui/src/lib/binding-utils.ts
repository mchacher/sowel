import type { EquipmentWithDetails } from "../types";

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
