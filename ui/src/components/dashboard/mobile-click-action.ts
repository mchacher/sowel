import type { TFunction } from "i18next";
import type { DashboardWidget, EquipmentWithDetails } from "../../types";
import { findOrderByCategory } from "../equipments/bindingUtils";
import { gateNeedsConfirm } from "./gate-confirm";
import { needsDetailSheet } from "./widget-utils";
import { resolveWidgetPresentation } from "./presentation/resolveWidgetPresentation";

/**
 * Determine the click action for a mobile equipment widget card:
 * detail sheet for complex types, direct toggle for simple on/off ones,
 * confirm sheet for guarded gates (spec 146), nothing otherwise.
 */
export function getMobileClickAction(
  widget: DashboardWidget,
  equipment: EquipmentWithDetails,
  t: TFunction,
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>,
  onOpenDetail?: () => void,
  onConfirmAction?: () => void,
): (() => void) | undefined {
  const type = equipment.type;

  // Complex widgets → open detail sheet
  if (needsDetailSheet(type)) return onOpenDetail;

  // Spec 149 — migrated types: the direct-tap toggle comes from the
  // presentation descriptor, the same source the desktop button uses, so the
  // alias/value semantics can no longer drift between the two surfaces.
  const presentation = resolveWidgetPresentation(widget, equipment, t);
  if (presentation) {
    const toggle = presentation.controls.find((c) => c.kind === "toggle");
    if (!toggle || !equipment.enabled) return undefined;
    return () => {
      void onExecuteOrder(equipment.id, toggle.alias, toggle.on ? toggle.offValue : toggle.onValue);
    };
  }

  // Gate: single action = direct toggle, multiple = detail sheet
  if (type === "gate") {
    const commandBinding = findOrderByCategory(
      equipment.orderBindings,
      ["gate_trigger"],
      ["command"],
    );
    const enumValues = commandBinding?.enumValues ?? [];
    if (commandBinding && enumValues.length <= 1) {
      // Spec 146 — guarded gate: open the slide-to-confirm sheet instead of
      // actuating on a single tap (issue #320).
      if (gateNeedsConfirm(equipment) && onConfirmAction) return onConfirmAction;
      return () => { void onExecuteOrder(equipment.id, commandBinding.alias, null); };
    }
    return onOpenDetail;
  }

  // Simple on/off (light_onoff, water_heater, water_valve) → direct toggle
  if (
    type === "light_onoff" ||
    type === "water_heater" ||
    type === "water_valve"
  ) {
    const stateBindingRaw = findOrderByCategory(
      equipment.orderBindings,
      ["light_toggle", "pool_pump_toggle", "valve_toggle", "toggle_power"],
      ["state"],
    );
    const stateBinding =
      stateBindingRaw &&
      (stateBindingRaw.type === "enum" || stateBindingRaw.type === "boolean")
        ? stateBindingRaw
        : undefined;
    if (stateBinding) {
      const dataBinding = equipment.dataBindings.find((db) => db.category === "light_state");
      const isOn = dataBinding
        ? dataBinding.value === true || dataBinding.value === "ON" || dataBinding.value === 1
        : false;
      return () => {
        const onVal = stateBinding.enumValues?.find((v) => /^on$/i.test(v)) ?? "ON";
        const offVal = stateBinding.enumValues?.find((v) => /^off$/i.test(v)) ?? "OFF";
        void onExecuteOrder(equipment.id, stateBinding.alias, isOn ? offVal : onVal);
      };
    }
  }

  // Sensor / weather → open detail sheet to see all data
  if (type === "sensor" || type === "weather") {
    return onOpenDetail;
  }

  return undefined;
}
