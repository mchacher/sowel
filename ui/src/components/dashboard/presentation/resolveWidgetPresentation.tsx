import { createElement, type ReactNode } from "react";
import { Tv } from "lucide-react";
import type { TFunction } from "i18next";
import type { DashboardWidget, EquipmentWithDetails } from "../../../types";
import { CUSTOM_ICON_REGISTRY } from "../widget-icons";
import { PlugWidgetIcon, PoolPumpIcon } from "../WidgetIcons";
import type { IconCtx, WidgetControl, WidgetPresentation } from "./types";
import {
  findToggleBinding,
  formatRuntime,
  isOnFromStateBinding,
  toggleValues,
} from "./resolve-helpers";

// Spec 149 (issue #325) — single source of truth for a widget type's
// icon/state/controls. Returns null for types not yet migrated: callers fall
// back to their legacy per-type path. The resolver and the legacy paths
// coexist until the last type is migrated.
//
// Pure function on purpose (no hooks): it can be exercised by plain unit
// tests and called from non-component code (the mobile tap action). Types
// that need store-derived context (e.g. sensor battery alerts) will receive
// it as an explicit argument when they migrate.

/** Custom widget icon (#318) wins over the type default on every surface. */
function iconWithOverride(
  widget: DashboardWidget,
  typeIcon: (ctx: IconCtx) => ReactNode,
): (ctx: IconCtx) => ReactNode {
  const custom = widget.icon ? CUSTOM_ICON_REGISTRY[widget.icon] : undefined;
  if (!custom) return typeIcon;
  return () => createElement(custom.component, custom.previewProps);
}

/** Build the single toggle control, or none when no togglable order exists. */
function toggleControlOf(
  equipment: EquipmentWithDetails,
  on: boolean,
  categories: Parameters<typeof findToggleBinding>[1],
): WidgetControl[] {
  const binding = findToggleBinding(equipment.orderBindings, categories);
  if (!binding) return [];
  return [{ kind: "toggle", alias: binding.alias, on, ...toggleValues(binding) }];
}

function resolveSwitch(
  widget: DashboardWidget,
  equipment: EquipmentWithDetails,
): WidgetPresentation {
  const on = isOnFromStateBinding(equipment);
  return {
    icon: iconWithOverride(widget, () => <PlugWidgetIcon on={on} />),
    isActive: on,
    state: { primary: on ? "ON" : "OFF" },
    controls: toggleControlOf(equipment, on, ["light_toggle", "toggle_power"]),
  };
}

function resolveMediaPlayer(
  widget: DashboardWidget,
  equipment: EquipmentWithDetails,
): WidgetPresentation {
  const powerBinding = equipment.dataBindings.find((b) => b.alias === "power");
  const sourceBinding = equipment.dataBindings.find((b) => b.alias === "input_source");
  const on = powerBinding?.value === true;
  const source = typeof sourceBinding?.value === "string" ? sourceBinding.value : null;
  const toggle = equipment.orderBindings.find((ob) => ob.alias === "power");
  return {
    icon: iconWithOverride(widget, (ctx) => (
      <Tv
        size={ctx.surface === "mobile-card" ? 96 : 64}
        strokeWidth={1}
        className={on ? "text-primary" : "text-text-tertiary"}
      />
    )),
    isActive: on,
    state: { primary: on ? (source ?? "ON") : "OFF" },
    controls: toggle
      ? [{ kind: "toggle", alias: toggle.alias, on, onValue: true, offValue: false }]
      : [],
  };
}

function resolvePoolPump(
  widget: DashboardWidget,
  equipment: EquipmentWithDetails,
): WidgetPresentation {
  const on = isOnFromStateBinding(equipment);
  const runtime = equipment.computedData?.find((c) => c.alias === "runtime_daily");
  const secondary =
    typeof runtime?.value === "number" ? [formatRuntime(runtime.value)] : undefined;
  return {
    icon: iconWithOverride(widget, () => <PoolPumpIcon on={on} />),
    isActive: on,
    state: { primary: on ? "ON" : "OFF", secondary },
    // Category-first incl. pool_pump_toggle so an unrelated boolean order on
    // multi-relay pumps (e.g. auto_mode) can't win over the real toggle.
    controls: toggleControlOf(equipment, on, [
      "pool_pump_toggle",
      "light_toggle",
      "toggle_power",
    ]),
  };
}

/**
 * Resolve the presentation descriptor for a dashboard equipment widget.
 * Returns null when the equipment type has not been migrated yet — the
 * caller must then use its legacy per-type rendering path.
 */
export function resolveWidgetPresentation(
  widget: DashboardWidget,
  equipment: EquipmentWithDetails,
  // Localizer for descriptor state text. The phase-1 types only emit
  // locale-neutral strings (ON/OFF, source names, runtimes) but the signature
  // takes it now so migrating a localized type never changes the call sites.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _t: TFunction,
): WidgetPresentation | null {
  switch (equipment.type) {
    case "switch":
      return resolveSwitch(widget, equipment);
    case "media_player":
      return resolveMediaPlayer(widget, equipment);
    case "pool_pump":
      return resolvePoolPump(widget, equipment);
    default:
      return null;
  }
}
