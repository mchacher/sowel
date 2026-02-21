import {
  getDevice,
  addDataBinding,
  addOrderBinding,
  removeDataBinding,
  removeOrderBinding,
} from "../../api";
import type { DataBindingWithValue, OrderBindingWithDetails } from "../../types";

/** Maps equipment types to relevant data categories for auto-binding. */
const RELEVANT_DATA: Record<string, string[]> = {
  light_onoff: ["light_state"],
  light_dimmable: ["light_state", "light_brightness"],
  light_color: ["light_state", "light_brightness", "light_color", "light_color_temp"],
  shutter: ["shutter_position"],
  switch: ["light_state"],
  sensor: ["temperature", "humidity", "pressure", "luminosity", "co2", "voc", "motion", "contact_door", "contact_window", "water_leak", "smoke", "battery"],
  button: ["action", "battery"],
};

/** Maps equipment types to relevant order keys for auto-binding. */
const RELEVANT_ORDERS: Record<string, string[]> = {
  light_onoff: ["state"],
  light_dimmable: ["state", "brightness"],
  light_color: ["state", "brightness", "color", "color_temp"],
  shutter: ["position", "state"],
  switch: ["state"],
  button: [],
};

export function isRelevantData(category: string, equipmentType: string): boolean {
  return RELEVANT_DATA[equipmentType]?.includes(category) ?? false;
}

export function isRelevantOrder(key: string, equipmentType: string): boolean {
  return RELEVANT_ORDERS[equipmentType]?.includes(key) ?? false;
}

/** Auto-create DataBindings and OrderBindings for selected devices. */
export async function autoCreateBindings(
  equipmentId: string,
  deviceIds: string[],
  equipmentType: string,
): Promise<void> {
  for (const deviceId of deviceIds) {
    try {
      const device = await getDevice(deviceId);

      for (const data of device.data) {
        if (isRelevantData(data.category, equipmentType)) {
          try {
            await addDataBinding(equipmentId, { deviceDataId: data.id, alias: data.key });
          } catch {
            // Alias conflict — skip
          }
        }
      }

      for (const order of device.orders) {
        if (isRelevantOrder(order.key, equipmentType)) {
          try {
            await addOrderBinding(equipmentId, { deviceOrderId: order.id, alias: order.key });
          } catch {
            // Already bound — skip
          }
        }
      }
    } catch {
      // Skip failed device
    }
  }
}

/** Remove all existing bindings from an equipment. */
export async function removeAllBindings(
  equipmentId: string,
  dataBindings: DataBindingWithValue[],
  orderBindings: OrderBindingWithDetails[],
): Promise<void> {
  for (const b of dataBindings) {
    try {
      await removeDataBinding(equipmentId, b.id);
    } catch {
      // Skip
    }
  }
  for (const b of orderBindings) {
    try {
      await removeOrderBinding(equipmentId, b.id);
    } catch {
      // Skip
    }
  }
}
