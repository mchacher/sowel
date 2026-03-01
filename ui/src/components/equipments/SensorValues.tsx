import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { DataBindingWithValue } from "../../types";
import {
  isBooleanSensorCategory,
  isBooleanActive,
  formatBooleanSensor,
  formatSensorValue,
  getBatteryIcon,
  getBatteryColor,
} from "./sensorUtils";
import { computeElapsed, formatElapsed } from "./useEquipmentState";

interface SensorValuesProps {
  sensorBindings: DataBindingWithValue[];
  batteryBindings: DataBindingWithValue[];
  /** Sparkline elements keyed by binding ID, rendered inline after matching values. */
  sparklines?: Record<string, React.ReactNode>;
}

export function SensorValues({
  sensorBindings,
  batteryBindings,
  sparklines,
}: SensorValuesProps) {
  const { t } = useTranslation();

  // Find lowest battery level for the compact indicator
  const minBattery = batteryBindings.reduce<number | null>((min, b) => {
    const lvl = typeof b.value === "number" ? b.value : null;
    if (lvl === null) return min;
    return min === null ? lvl : Math.min(min, lvl);
  }, null);

  // Build tooltip with all battery levels
  const batteryTooltip = batteryBindings
    .map((b) => {
      const lvl = typeof b.value === "number" ? b.value : null;
      return `${b.deviceName}: ${lvl !== null ? `${lvl}%` : "?"}`;
    })
    .join("\n");

  return (
    <>
      {/* Sensor values */}
      {sensorBindings.length > 0 && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {sensorBindings.map((b) => (
            <span key={b.id} className="text-[13px] tabular-nums flex-shrink-0 inline-flex items-center gap-1.5">
              {b.category === "motion" && isBooleanActive(b.category, b.value) ? (
                <span className="font-medium px-2 py-0.5 rounded-full text-[11px] bg-active/15 text-active-text inline-flex items-center gap-1">
                  {formatBooleanSensor(b.category, b.value, t)}
                  <ElapsedCounter lastUpdated={b.lastUpdated} lockOrigin />
                </span>
              ) : b.category === "action" && b.value != null ? (
                <span className="font-medium px-2 py-0.5 rounded-full text-[11px] bg-primary/10 text-primary inline-flex items-center gap-1">
                  {String(b.value)}
                  <ElapsedCounter lastUpdated={b.lastUpdated} />
                </span>
              ) : isBooleanSensorCategory(b.category) ? (
                <span
                  className={`
                    font-medium px-2 py-0.5 rounded-full text-[11px]
                    ${isBooleanActive(b.category, b.value)
                      ? "bg-active/15 text-active-text"
                      : "bg-border-light text-text-tertiary"
                    }
                  `}
                >
                  {formatBooleanSensor(b.category, b.value, t)}
                </span>
              ) : (
                <span className="text-text-secondary">
                  {formatSensorValue(b.value, b.unit, t)}
                </span>
              )}
              {sparklines?.[b.id]}
            </span>
          ))}
        </div>
      )}

      {/* Battery indicator — shows lowest level, tooltip lists all */}
      {batteryBindings.length > 0 && (
        <span
          className={`flex items-center gap-0.5 flex-shrink-0 ${getBatteryColor(minBattery)}`}
          title={batteryBindings.length > 1 ? batteryTooltip : `${t("sensors.battery")} : ${minBattery ?? "?"}%`}
        >
          {getBatteryIcon(minBattery, 14, 1.5)}
          <span className="text-[11px] tabular-nums">
            {minBattery !== null ? `${minBattery}%` : "?"}
          </span>
        </span>
      )}
    </>
  );
}

/**
 * Live elapsed counter — ticks every second.
 * lockOrigin: when true, keeps the first timestamp seen (for motion sensors
 * that re-send occupancy=true every ~60s). The counter resets naturally when
 * the component unmounts (motion stops) and remounts (motion resumes).
 */
function ElapsedCounter({ lastUpdated, lockOrigin }: { lastUpdated: string | null; lockOrigin?: boolean }) {
  const [lockedOrigin] = useState(lastUpdated);
  const origin = lockOrigin ? lockedOrigin : lastUpdated;

  const [elapsed, setElapsed] = useState(() => computeElapsed(origin));

  useEffect(() => {
    setElapsed(computeElapsed(origin)); // eslint-disable-line react-hooks/set-state-in-effect -- sync initial elapsed before starting interval
    const id = setInterval(() => setElapsed(computeElapsed(origin)), 1000);
    return () => clearInterval(id);
  }, [origin]);

  return (
    <span className="tabular-nums opacity-80">{formatElapsed(elapsed)}</span>
  );
}
