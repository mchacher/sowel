import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { Power, ChevronUp, Square, ChevronDown } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";
import { TYPE_ICONS } from "../equipments/EquipmentCard";
import {
  getSensorIcon,
  getSensorIconColor,
  getSensorBindings,
  getBatteryBinding,
  getBatteryIcon,
  getBatteryColor,
  isBooleanSensorCategory,
  formatBooleanSensor,
  formatSensorValue,
} from "../equipments/sensorUtils";

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

  const isShutter = equipment.type === "shutter";

  const isSensor =
    equipment.type === "sensor" ||
    equipment.type === "motion_sensor" ||
    equipment.type === "contact_sensor";

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

  // Sensor-specific data
  const sensorBindings = isSensor ? getSensorBindings(equipment.dataBindings) : [];
  const batteryBinding = isSensor ? getBatteryBinding(equipment.dataBindings) : null;
  const batteryLevel = batteryBinding && typeof batteryBinding.value === "number" ? batteryBinding.value : null;

  // Shutter-specific data
  const shutterPositionBinding = isShutter
    ? equipment.dataBindings.find((db) => db.category === "shutter_position")
    : null;
  const shutterPosition = shutterPositionBinding && typeof shutterPositionBinding.value === "number"
    ? shutterPositionBinding.value
    : null;
  const hasShutterState = isShutter && equipment.orderBindings.some((ob) => ob.alias === "state");

  // Find primary data value for non-light, non-sensor, non-shutter equipments
  const primaryBinding = !isLight && !isSensor && !isShutter
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

  const handleShutterCommand = async (command: "OPEN" | "STOP" | "CLOSE", e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (executing || !hasShutterState) return;
    setExecuting(true);
    try {
      await onExecuteOrder(equipment.id, "state", command);
    } finally {
      setExecuting(false);
    }
  };

  // Determine icon and icon color
  const iconElement = isSensor
    ? getSensorIcon(equipment.dataBindings)
    : TYPE_ICONS[equipment.type];

  const shutterIsOpen = shutterPosition !== null && shutterPosition > 0;

  const iconColor = isSensor
    ? getSensorIconColor(equipment.dataBindings)
    : isShutter
      ? shutterIsOpen
        ? "bg-primary/10 text-primary"
        : "bg-border-light text-text-tertiary"
      : isLight && isOn
        ? "bg-amber-400/15 text-amber-500"
        : isOn
          ? "bg-primary/10 text-primary"
          : "bg-border-light text-text-tertiary";

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-2.5
        transition-colors duration-150
        hover:bg-border-light/40
      `}
    >
      {/* Icon */}
      <div
        className={`
          flex-shrink-0 w-8 h-8 rounded-[6px] flex items-center justify-center
          ${iconColor}
        `}
      >
        {iconElement}
      </div>

      {/* Name — links to detail */}
      <Link
        to={`/equipments/${equipment.id}`}
        className="flex-1 min-w-0 text-[13px] font-medium text-text truncate hover:text-primary transition-colors"
      >
        {equipment.name}
      </Link>

      {/* Sensor values (multi-value) */}
      {isSensor && sensorBindings.length > 0 && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {sensorBindings.map((b) => (
            <span key={b.id} className="text-[13px] tabular-nums flex-shrink-0">
              {b.category === "motion" && isBooleanActive(b.category, b.value) ? (
                <span className="font-medium px-2 py-0.5 rounded-full text-[11px] bg-amber-400/15 text-amber-500 inline-flex items-center gap-1">
                  {formatBooleanSensor(b.category, b.value)}
                  <ElapsedCounter lastUpdated={b.lastUpdated} />
                </span>
              ) : isBooleanSensorCategory(b.category) ? (
                <span
                  className={`
                    font-medium px-2 py-0.5 rounded-full text-[11px]
                    ${isBooleanActive(b.category, b.value)
                      ? "bg-amber-400/15 text-amber-500"
                      : "bg-border-light text-text-tertiary"
                    }
                  `}
                >
                  {formatBooleanSensor(b.category, b.value)}
                </span>
              ) : (
                <span className="text-text-secondary">
                  {formatSensorValue(b.value, b.unit)}
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Battery indicator for sensors */}
      {isSensor && batteryBinding && (
        <span className={`flex items-center gap-0.5 flex-shrink-0 ${getBatteryColor(batteryLevel)}`} title={`Batterie : ${batteryLevel ?? "?"}%`}>
          {getBatteryIcon(batteryLevel, 14, 1.5)}
          <span className="text-[11px] tabular-nums">{batteryLevel !== null ? `${batteryLevel}%` : "?"}</span>
        </span>
      )}

      {/* Primary value for non-light, non-sensor, non-shutter equipments */}
      {primaryBinding && !isLight && !isSensor && !isShutter && (
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
          {isOn && stateBinding?.lastUpdated && (
            <span className="text-[11px] text-text-tertiary tabular-nums">
              <ElapsedCounter lastUpdated={stateBinding.lastUpdated} />
            </span>
          )}
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

      {/* Shutter controls */}
      {isShutter && equipment.enabled && (
        <div
          className="flex items-center gap-2 flex-shrink-0"
          onClick={(e) => e.preventDefault()}
        >
          {shutterPosition !== null && (
            <span className="text-[13px] text-text-secondary tabular-nums text-right">
              {shutterPosition === 0 ? "Fermé" : shutterPosition === 100 ? "Ouvert" : `${shutterPosition}%`}
            </span>
          )}
          {hasShutterState && (
            <>
              <div className="w-px h-5 bg-border" />
              <button
                onClick={(e) => handleShutterCommand("OPEN", e)}
                disabled={executing}
                className="p-1.5 rounded-[5px] transition-colors duration-150 cursor-pointer bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                title="Ouvrir"
              >
                <ChevronUp size={14} strokeWidth={1.5} />
              </button>
              <button
                onClick={(e) => handleShutterCommand("STOP", e)}
                disabled={executing}
                className="p-1.5 rounded-[5px] transition-colors duration-150 cursor-pointer bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                title="Stop"
              >
                <Square size={10} strokeWidth={2} />
              </button>
              <button
                onClick={(e) => handleShutterCommand("CLOSE", e)}
                disabled={executing}
                className="p-1.5 rounded-[5px] transition-colors duration-150 cursor-pointer bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                title="Fermer"
              >
                <ChevronDown size={14} strokeWidth={1.5} />
              </button>
            </>
          )}
        </div>
      )}

      {/* Boolean state badge for non-light, non-sensor, non-shutter equipments */}
      {!isLight && !isSensor && !isShutter && stateBinding && (
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

function isBooleanActive(category: string, value: unknown): boolean {
  if (category === "contact_door" || category === "contact_window") {
    return value === false || value === "OFF"; // contact=false means open
  }
  return value === true || value === "ON";
}

/** Live elapsed counter for active motion sensors — ticks every second. */
function ElapsedCounter({ lastUpdated }: { lastUpdated: string | null }) {
  const [elapsed, setElapsed] = useState(() => computeElapsed(lastUpdated));

  useEffect(() => {
    setElapsed(computeElapsed(lastUpdated));
    const id = setInterval(() => setElapsed(computeElapsed(lastUpdated)), 1000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  return <span className="tabular-nums opacity-80">{formatElapsed(elapsed)}</span>;
}

function computeElapsed(iso: string | null): number {
  if (!iso) return 0;
  const ts = iso.endsWith("Z") ? iso : `${iso}Z`;
  return Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
}

function formatElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h${String(m).padStart(2, "0")}`;
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
