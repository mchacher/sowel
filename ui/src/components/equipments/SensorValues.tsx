import { useEffect, useReducer } from "react";
import { useTranslation } from "react-i18next";
import type { BatteryAlert, DataBindingWithValue } from "../../types";
import {
  isBooleanSensorCategory,
  isBooleanActive,
  booleanSensorTone,
  formatBooleanSensor,
  formatSensorValue,
  getBatteryIcon,
  getBatteryColor,
} from "./sensorUtils";
import { computeElapsed, formatElapsed } from "./useEquipmentState";
import { formatPercent } from "../../lib/format";

interface SensorValuesProps {
  sensorBindings: DataBindingWithValue[];
  batteryBindings: DataBindingWithValue[];
  /**
   * Spec 143 — active low-battery alert on one of the equipment's devices.
   * Set even when the equipment binds no battery data, which is why the
   * indicator cannot be derived from `batteryBindings` alone.
   */
  batteryAlert?: BatteryAlert | null;
  /**
   * "row" (default) = horizontal, "column" = stacked vertically,
   * "wrap" = horizontal but values wrap onto further lines (equipment list on phones).
   */
  layout?: "row" | "column" | "wrap";
}

const VALUES_LAYOUT_CLASS: Record<NonNullable<SensorValuesProps["layout"]>, string> = {
  row: "flex items-center gap-2 flex-shrink-0",
  column: "flex flex-col gap-0.5",
  wrap: "flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0",
};

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
      return `${b.deviceName}: ${lvl !== null ? formatPercent(lvl) : "?"}`;
    })
    .join("\n");

  const batteryTitle = batteryAlert
    ? `${batteryAlert.deviceName} — ${t("sensors.battery")}${shownLevel !== null ? ` : ${formatPercent(shownLevel)}` : ""}`
    : batteryBindings.length > 1
      ? batteryTooltip
      : `${t("sensors.battery")} : ${formatPercent(shownLevel)}`;

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
          {shownLevel !== null && <span className="text-micro tabular-nums">{formatPercent(shownLevel)}</span>}
        </span>
      )}

      {/* Sensor values */}
      {sensorBindings.length > 0 && (
        <div className={VALUES_LAYOUT_CLASS[layout]}>
          {sensorBindings.map((b) => (
            <span key={b.id} className={layout === "wrap" ? "text-small tabular-nums" : "text-small tabular-nums flex-shrink-0"}>
              {b.category === "motion" && isBooleanActive(b.category, b.value) ? (
                <span className="font-medium px-2 py-0.5 rounded-full text-micro bg-primary/10 text-primary inline-flex items-center gap-1">
                  {formatBooleanSensor(b.category, b.value, t)}
                  <ElapsedCounter origin={b.lastChanged ?? b.lastUpdated} />
                </span>
              ) : b.category === "action" && b.value != null ? (
                <span className="font-medium px-2 py-0.5 rounded-full text-micro bg-primary/10 text-primary inline-flex items-center gap-1">
                  {t(`buttonActions.action.${String(b.value)}`, { defaultValue: String(b.value) })}
                  <ElapsedCounter origin={b.lastChanged ?? b.lastUpdated} />
                </span>
              ) : isBooleanSensorCategory(b.category) ? (
                <span
                  className={`
                    font-medium px-2 py-0.5 rounded-full text-micro
                    ${booleanSensorTone(b.category, isBooleanActive(b.category, b.value)).pill}
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
