import type { TFunction } from "i18next";
import type { DashboardWidget, EquipmentWithDetails } from "../../types";
import { findOrderByCategory } from "../equipments/bindingUtils";
import { gateNeedsConfirm } from "./gate-confirm";
import { needsDetailSheet } from "./widget-utils";
import { resolveWidgetPresentation } from "./presentation/resolveWidgetPresentation";

/**
 * What a tap on a mobile tile does (spec 196, pr8-geste). The tile draws it as
 * a corner glyph so a direct toggle never looks like a tile that opens a sheet:
 * - `toggle`: flips an on/off equipment on the spot;
 * - `now`: actuates at once, no state to flip (an unguarded gate impulse, a
 *   recipe tile's single control, a timed tile);
 * - `sheet`: opens the detail sheet;
 * - `confirm`: asks for a slide before actuating (spec 146).
 */
export type MobileTapKind = "toggle" | "now" | "sheet" | "confirm";

export interface MobileClickAction {
  kind: MobileTapKind;
  run: () => void;
}

/** The corner glyph each gesture is drawn with. */
export type TapGlyphName = "power" | "chevron" | "shield";

export function tapGlyphOf(kind: MobileTapKind): TapGlyphName {
  if (kind === "sheet") return "chevron";
  if (kind === "confirm") return "shield";
  return "power";
}

function sheet(onOpenDetail: (() => void) | undefined): MobileClickAction | undefined {
  // A tile must not advertise a tap that leads nowhere.
  return onOpenDetail ? { kind: "sheet", run: onOpenDetail } : undefined;
}

/**
 * Determine the click action for a mobile equipment widget card:
 * detail sheet for complex types, direct toggle for simple on/off ones,
 * confirm sheet for guarded gates (spec 146), nothing otherwise. A disabled
 * equipment never actuates on a tap (spec 196).
 */
export function getMobileClickAction(
  widget: DashboardWidget,
  equipment: EquipmentWithDetails,
  t: TFunction,
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>,
  onOpenDetail?: () => void,
  onConfirmAction?: () => void,
): MobileClickAction | undefined {
  const type = equipment.type;

  // Complex widgets → open detail sheet
  if (needsDetailSheet(type)) return sheet(onOpenDetail);

  // Spec 149 — migrated types: the direct-tap toggle comes from the
  // presentation descriptor, the same source the desktop button uses, so the
  // alias/value semantics can no longer drift between the two surfaces.
  const presentation = resolveWidgetPresentation(widget, equipment, t);
  if (presentation) {
    const toggle = presentation.controls.find((c) => c.kind === "toggle");
    if (!toggle || !equipment.enabled) return undefined;
    return {
      kind: "toggle",
      run: () => {
        void onExecuteOrder(
          equipment.id,
          toggle.alias,
          toggle.on ? toggle.offValue : toggle.onValue,
        );
      },
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
      // A disabled gate does not actuate on a tap, like a disabled light (spec 196).
      if (!equipment.enabled) return undefined;
      // Spec 146 — guarded gate: open the slide-to-confirm sheet instead of
      // actuating on a single tap (issue #320).
      if (gateNeedsConfirm(equipment) && onConfirmAction) {
        return { kind: "confirm", run: onConfirmAction };
      }
      return {
        kind: "now",
        run: () => {
          void onExecuteOrder(equipment.id, commandBinding.alias, null);
        },
      };
    }
    return sheet(onOpenDetail);
  }

  // Simple on/off (light_onoff, water_heater, water_valve) → direct toggle
  if (type === "light_onoff" || type === "water_heater" || type === "water_valve") {
    // Spec 196 — the desktop tile already refuses a disabled light; the phone
    // used to toggle it anyway.
    if (!equipment.enabled) return undefined;
    const mainRaw = findOrderByCategory(
      equipment.orderBindings,
      ["light_toggle", "pool_pump_toggle", "valve_toggle", "toggle_power"],
      ["state"],
    );
    // Spec 152 — a water heater on permanent mains carries only a "solar"
    // channel; with no main on/off, the single mobile tap toggles solar. When
    // both exist, main wins (solar is managed from the detail sheet).
    const solarRaw = findOrderByCategory(equipment.orderBindings, ["solar_toggle"], ["solar"]);
    const usingSolar = !mainRaw && !!solarRaw;
    const chosenRaw = mainRaw ?? solarRaw;
    const stateBinding =
      chosenRaw && (chosenRaw.type === "enum" || chosenRaw.type === "boolean")
        ? chosenRaw
        : undefined;
    if (stateBinding) {
      const stateCategory = usingSolar ? "solar_state" : "light_state";
      const dataBinding = equipment.dataBindings.find((db) => db.category === stateCategory);
      const isOn = dataBinding
        ? dataBinding.value === true || dataBinding.value === "ON" || dataBinding.value === 1
        : false;
      return {
        kind: "toggle",
        run: () => {
          const onVal = stateBinding.enumValues?.find((v) => /^on$/i.test(v)) ?? "ON";
          const offVal = stateBinding.enumValues?.find((v) => /^off$/i.test(v)) ?? "OFF";
          void onExecuteOrder(equipment.id, stateBinding.alias, isOn ? offVal : onVal);
        },
      };
    }
  }

  // Sensor / weather → open detail sheet to see all data.
  // Spec 168 adds the forecast: the tile qualifies tomorrow, the sheet shows
  // the five days as columns, each with its confidence.
  if (type === "sensor" || type === "weather" || type === "weather_forecast") {
    return sheet(onOpenDetail);
  }

  return undefined;
}
