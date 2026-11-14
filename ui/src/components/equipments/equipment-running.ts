import type { EquipmentWithDetails } from "../../types";
import { thermostatPowerStateBinding } from "../../lib/thermostat-state";
import { relayStateOn } from "./bindingUtils";
import { evChargerStateOf } from "./evChargerState";
import { electricVehicleStateOf } from "./electricVehicleState";
import { vmcSpeedOf } from "./vmcSpeed";

/**
 * Spec 208 (FR4) — the equipment is running now: its tile takes the full colour
 * of its family. Each rule reads the same binding the equipment's control reads,
 * so the tile and the control never disagree. Types with no running state
 * (openings, meters, sensors, a button) are never running: their state is a
 * position or a reading, said by the row's pill.
 */
export function isRunning(equipment: EquipmentWithDetails): boolean {
  const bindings = equipment.dataBindings;
  switch (equipment.type) {
    case "light_onoff":
    case "light_dimmable":
    case "light_color":
    case "switch":
    case "water_valve":
    case "pool_pump":
    case "water_heater":
      return relayStateOn(bindings);
    // Pilot wire: the relay off lets the radiator heat (comfort), as its badge
    // says — with no state reading too, where the badge reads « Confort ».
    case "heater":
      return !relayStateOn(bindings);
    case "thermostat":
      return thermostatPowerStateBinding(bindings)?.value === true;
    case "pool_heat_pump": {
      const mode = bindings.find((b) => b.alias === "mode")?.value;
      return typeof mode === "string" && mode.toUpperCase() !== "OFF";
    }
    case "vmc": {
      const speed = vmcSpeedOf(equipment);
      return speed !== null && speed !== "off";
    }
    case "ev_charger":
      return evChargerStateOf(equipment).vehicle === "charging";
    case "electric_vehicle":
      return electricVehicleStateOf(equipment).chargingState === "charging";
    default:
      return false;
  }
}
