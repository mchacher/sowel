import { useState, useRef } from "react";
import { Link } from "react-router-dom";
import { Power } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";
import { TYPE_ICONS } from "../equipments/EquipmentCard";

const SETTLE_DELAY_MS = 2000;

interface CompactEquipmentCardProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
}

export function CompactEquipmentCard({ equipment, onExecuteOrder }: CompactEquipmentCardProps) {
  const [executing, setExecuting] = useState(false);
  const [, forceRender] = useState(0);
  const localBrightness = useRef<number | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLight =
    equipment.type === "light_onoff" ||
    equipment.type === "light_dimmable" ||
    equipment.type === "light_color";

  const stateBinding = equipment.dataBindings.find(
    (db) => db.alias === "state" || db.category === "light_state"
  );
  const brightnessBinding = equipment.dataBindings.find(
    (db) => db.alias === "brightness" || db.category === "light_brightness"
  );

  const isOn = stateBinding
    ? stateBinding.value === true || stateBinding.value === "ON"
    : false;

  const deviceBrightness = brightnessBinding
    ? typeof brightnessBinding.value === "number"
      ? brightnessBinding.value
      : null
    : null;

  const brightness =
    localBrightness.current !== null ? localBrightness.current : deviceBrightness;

  const hasToggle = equipment.orderBindings.some(
    (ob) => ob.alias === "state" || ob.alias === "turn_on"
  );
  const hasBrightness = equipment.orderBindings.some(
    (ob) => ob.alias === "brightness"
  );

  // Find primary data value for non-light equipments
  const primaryBinding = !isLight
    ? equipment.dataBindings[0] ?? null
    : null;

  const handleToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (executing || !hasToggle) return;
    setExecuting(true);
    try {
      const alias = equipment.orderBindings.find((ob) => ob.alias === "state")
        ? "state"
        : "turn_on";
      const value = isOn
        ? alias === "state" ? "OFF" : false
        : alias === "state" ? "ON" : true;
      await onExecuteOrder(equipment.id, alias, value);
    } finally {
      setExecuting(false);
    }
  };

  const handleBrightnessChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (settleTimer.current) clearTimeout(settleTimer.current);
    localBrightness.current = Number(e.target.value);
    forceRender((n) => n + 1);
  };

  const handleBrightnessCommit = async () => {
    const commitValue = localBrightness.current;
    if (!hasBrightness || commitValue === null) return;
    try {
      await onExecuteOrder(equipment.id, "brightness", commitValue);
    } catch {
      // Ignore
    }
    settleTimer.current = setTimeout(() => {
      localBrightness.current = null;
      settleTimer.current = null;
      forceRender((n) => n + 1);
    }, SETTLE_DELAY_MS);
  };

  return (
    <div
      className={`
        flex items-center gap-3 px-3 py-2.5 rounded-[8px] border
        transition-colors duration-150
        border-border bg-surface
      `}
    >
      {/* Icon */}
      <div
        className={`
          flex-shrink-0 w-8 h-8 rounded-[6px] flex items-center justify-center
          ${isLight && isOn ? "bg-amber-400/15 text-amber-500" : isOn ? "bg-primary/10 text-primary" : "bg-border-light text-text-tertiary"}
        `}
      >
        {TYPE_ICONS[equipment.type]}
      </div>

      {/* Name — links to detail */}
      <Link
        to={`/equipments/${equipment.id}`}
        className="flex-1 min-w-0 text-[13px] font-medium text-text truncate hover:text-primary transition-colors"
      >
        {equipment.name}
      </Link>

      {/* Primary value for non-light equipments */}
      {primaryBinding && !isLight && (
        <span className="text-[13px] text-text-secondary tabular-nums flex-shrink-0">
          {formatValue(primaryBinding.value, primaryBinding.unit)}
        </span>
      )}

      {/* Light controls */}
      {isLight && equipment.enabled && (
        <div
          className="flex items-center gap-2 flex-shrink-0"
          onClick={(e) => e.preventDefault()}
        >
          {hasBrightness && brightness !== null && (
            <div className="flex items-center gap-1.5">
              <input
                type="range"
                min={0}
                max={254}
                value={brightness}
                onChange={handleBrightnessChange}
                onMouseUp={handleBrightnessCommit}
                onTouchEnd={handleBrightnessCommit}
                onClick={(e) => e.stopPropagation()}
                className="w-[60px] accent-primary h-1"
              />
              <span className="text-[11px] text-text-tertiary w-6 text-right tabular-nums">
                {Math.round((brightness / 254) * 100)}%
              </span>
            </div>
          )}
          <div className="w-px h-5 bg-border" />
          {hasToggle && (
            <button
              onClick={handleToggle}
              disabled={executing}
              className={`
                p-1.5 rounded-[5px] transition-colors duration-150 cursor-pointer
                ${isOn
                  ? "bg-primary text-white hover:bg-primary-hover"
                  : "bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary"
                }
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
              title={isOn ? "Turn off" : "Turn on"}
            >
              <Power size={14} strokeWidth={1.5} />
            </button>
          )}
        </div>
      )}

      {/* Boolean state badge for non-light equipments */}
      {!isLight && stateBinding && (
        <span
          className={`
            text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0
            ${isOn
              ? "bg-success/10 text-success"
              : "bg-border-light text-text-tertiary"
            }
          `}
        >
          {isOn ? "ON" : "OFF"}
        </span>
      )}
    </div>
  );
}

function formatValue(value: unknown, unit?: string): string {
  if (value === null || value === undefined) return "\u2014";
  if (typeof value === "boolean") return value ? "ON" : "OFF";
  if (typeof value === "number") {
    const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1);
    return unit ? `${formatted}${unit}` : formatted;
  }
  return String(value);
}
