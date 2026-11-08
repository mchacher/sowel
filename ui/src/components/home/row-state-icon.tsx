import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import { DoorClosed, DoorOpen } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";
import { ShutterIcon } from "../icons/ShutterIcons";
import { AwningIcon } from "../icons/AwningIcon";
import { gateStateOf } from "../dashboard/gate-confirm";
import { doorState } from "../../../../src/shared/door-state";
import { formatPercent } from "../../lib/format";

/** Types whose row reading is an open / closed or position pill (#1163). */
const STATE_ICON_TYPES = new Set(["shutter", "awning", "pool_cover", "door", "gate"]);

/** Whether this type's state lives in the row's icon, its pill only from `sm`. */
export function hasRowStateIcon(equipment: EquipmentWithDetails): boolean {
  return STATE_ICON_TYPES.has(equipment.type);
}

export interface RowState {
  /** The state-aware picto, or null to keep the type's own (moving, unknown). */
  icon: ReactNode | null;
  /** The state in words, for the icon's accessible label and tooltip. */
  label: string;
  /**
   * A state that must stay readable on phones too (a door fault or moving, a
   * gate whose state is unknown): the icon has nothing to say it with.
   */
  keepPill: boolean;
}

function positionOf(equipment: EquipmentWithDetails): number | null {
  const binding = equipment.dataBindings.find(
    (db) => db.category === "shutter_position" || db.alias === "position",
  );
  return binding && typeof binding.value === "number" ? binding.value : null;
}

/**
 * The state a shutter, awning, pool cover, door or gate row draws in its icon,
 * with the same words as its pill (#1163): on a phone the pill is gone from
 * every row of the type, so the icon is where the state is read. Null for other
 * types, and when the state is not known.
 */
export function rowStateOf(equipment: EquipmentWithDetails, t: TFunction): RowState | null {
  const type = equipment.type;
  if (type === "gate") {
    const state = gateStateOf(equipment);
    // The type's picto is an open door: without the pill it would read "open".
    if (state === "unknown")
      return { icon: null, label: t("controls.gate.unknown"), keepPill: true };
    const Icon = state === "open" ? DoorOpen : DoorClosed;
    return {
      icon: <Icon size={18} strokeWidth={1.5} />,
      label: t(`controls.gate.${state}`),
      keepPill: false,
    };
  }

  if (type === "door") {
    const word = doorState(equipment.dataBindings.filter((db) => db.alias === "state"));
    if (word === "open" || word === "closed") {
      const Icon = word === "open" ? DoorOpen : DoorClosed;
      return {
        icon: <Icon size={18} strokeWidth={1.5} />,
        label: t(word === "open" ? "controls.doorOpen" : "controls.doorClosed"),
        keepPill: false,
      };
    }
    // Moving draws as open in the type's picto: the pill says it is moving.
    if (word === "moving") return { icon: null, label: t("controls.doorMoving"), keepPill: true };
    if (word === "fault") return { icon: null, label: t("controls.doorFault"), keepPill: true };
    // No word: the position decides, as for a shutter.
    const position = positionOf(equipment);
    if (position === null) return null;
    const Icon = position > 0 ? DoorOpen : DoorClosed;
    return {
      icon: <Icon size={18} strokeWidth={1.5} />,
      label:
        position === 0
          ? t("controls.doorClosed")
          : position === 100
            ? t("controls.doorOpen")
            : t("controls.doorOpenAt", { value: formatPercent(position) }),
      keepPill: false,
    };
  }

  if (type === "shutter" || type === "pool_cover" || type === "awning") {
    const position = positionOf(equipment);
    if (position === null) return null;
    if (type === "awning") {
      return {
        icon: <AwningIcon size={22} state={position > 0 ? "open" : "closed"} />,
        label:
          position === 0
            ? t("controls.retracted")
            : position === 100
              ? t("controls.deployed")
              : t("controls.deployedAt", { value: formatPercent(position) }),
        keepPill: false,
      };
    }
    return {
      icon: <ShutterIcon size={18} strokeWidth={1.5} position={position} />,
      label:
        position === 0
          ? t("controls.closed")
          : position === 100
            ? t("controls.opened")
            : t("controls.openedAt", { value: formatPercent(position) }),
      keepPill: false,
    };
  }

  return null;
}
