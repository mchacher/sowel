import { useEffect, useReducer } from "react";
import { useTranslation } from "react-i18next";
import type { BatteryAlert, DataBindingWithValue } from "../../types";
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
  /**
   * Spec 143 — active low-battery alert on one of the equipment's devices.
   * Set even when the equipment binds no battery data, which is why the
   * indicator cannot be derived from `batteryBindings` alone.
   */
  batteryAlert?: BatteryAlert | null;
  /** "row" (default) = horizontal, "column" = stacked vertically */
  layout?: "row" | "column";
}

export function SensorValues({
  sensorBindings,
  batteryBindings,
  batteryAlert = null,
  layout = "row",
}: SensorValuesProps) {
  const { t } = useTranslation();

  // Find lowest battery level for the compact indicator
  const minBattery = batteryBindings.reduce<number | null>((min, b) => {
    const lvl = typeof b.value === "number" ? b.value : null;
    if (lvl === null) return min;
    return min === null ? lvl : Math.min(min, lvl);
  }, null);

  // The alert's own level, for equipments that don't bind the battery data.
  const alertLevel = batteryAlert && /^\d+$/.test(batteryAlert.value)
    ? Number(batteryAlert.value)
    : null;
  const shownLevel = minBattery ?? alertLevel;

  // Shown when low (< 30%) — informative — or whenever the engine raised an
  // alert, including a battery_low boolean with no percentage at all.
  const showBattery = batteryAlert !== null || (shownLevel !== null && shownLevel < 30);

  // Build tooltip with all battery levels
  const batteryTooltip = batteryBindings
    .map((b) => {
      const lvl = typeof b.value === "number" ? b.value : null;
      return `${b.deviceName}: ${lvl !== null ? `${lvl}%` : "?"}`;
    })
    .join("\n");

  const batteryTitle = batteryAlert
    ? `${batteryAlert.deviceName} — ${t("sensors.battery")}${shownLevel !== null ? ` : ${shownLevel}%` : ""}`
    : batteryBindings.length > 1
      ? batteryTooltip
      : `${t("sensors.battery")} : ${shownLevel}%`;

  return (
    <>
      {/* Battery indicator — first, so it sits left of the sensor values */}
      {showBattery && (
        <span
          className={`flex items-center gap-0.5 flex-shrink-0 ${
            batteryAlert ? "text-error" : getBatteryColor(shownLevel ?? 0)
          }`}
          title={batteryTitle}
        >
          {getBatteryIcon(shownLevel, 14, 1.5)}
          {shownLevel !== null && <span className="text-[11px] tabular-nums">{shownLevel}%</span>}
        </span>
      )}

      {/* Sensor values */}
      {sensorBindings.length > 0 && (
        <div className={layout === "column" ? "flex flex-col gap-0.5" : "flex items-center gap-2 flex-shrink-0"}>
          {sensorBindings.map((b) => (
            <span key={b.id} className="text-[13px] tabular-nums flex-shrink-0">
              {b.category === "motion" && isBooleanActive(b.category, b.value) ? (
                <span className="font-medium px-2 py-0.5 rounded-full text-[11px] bg-active/15 text-active-text inline-flex items-center gap-1">
                  {formatBooleanSensor(b.category, b.value, t)}
                  <ElapsedCounter origin={b.lastChanged ?? b.lastUpdated} />
                </span>
              ) : b.category === "action" && b.value != null ? (
                <span className="font-medium px-2 py-0.5 rounded-full text-[11px] bg-primary/10 text-primary inline-flex items-center gap-1">
                  {String(b.value)}
                  <ElapsedCounter origin={b.lastChanged ?? b.lastUpdated} />
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
            </span>
          ))}
        </div>
      )}

    </>
  );
}

/**
 * Live elapsed counter — ticks every second.
 * Uses last_changed timestamp (only updates on actual value transitions).
 */
function ElapsedCounter({ origin }: { origin: string | null }) {
  const [, tick] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [origin]);

  return (
    <span className="tabular-nums opacity-80">{formatElapsed(computeElapsed(origin))}</span>
  );
}
