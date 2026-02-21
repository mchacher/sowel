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
  batteryBinding: DataBindingWithValue | null;
  batteryLevel: number | null;
}

export function SensorValues({
  sensorBindings,
  batteryBinding,
  batteryLevel,
}: SensorValuesProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* Sensor values */}
      {sensorBindings.length > 0 && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {sensorBindings.map((b) => (
            <span key={b.id} className="text-[13px] tabular-nums flex-shrink-0">
              {b.category === "motion" && isBooleanActive(b.category, b.value) ? (
                <span className="font-medium px-2 py-0.5 rounded-full text-[11px] bg-amber-400/15 text-amber-500 inline-flex items-center gap-1">
                  {formatBooleanSensor(b.category, b.value, t)}
                  <ElapsedCounter lastUpdated={b.lastUpdated} />
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
                      ? "bg-amber-400/15 text-amber-500"
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

      {/* Battery indicator */}
      {batteryBinding && (
        <span
          className={`flex items-center gap-0.5 flex-shrink-0 ${getBatteryColor(batteryLevel)}`}
          title={`${t("sensors.battery")} : ${batteryLevel ?? "?"}%`}
        >
          {getBatteryIcon(batteryLevel, 14, 1.5)}
          <span className="text-[11px] tabular-nums">
            {batteryLevel !== null ? `${batteryLevel}%` : "?"}
          </span>
        </span>
      )}
    </>
  );
}

/** Live elapsed counter — ticks every second. */
function ElapsedCounter({ lastUpdated }: { lastUpdated: string | null }) {
  const [elapsed, setElapsed] = useState(() => computeElapsed(lastUpdated));

  useEffect(() => {
    setElapsed(computeElapsed(lastUpdated));
    const id = setInterval(
      () => setElapsed(computeElapsed(lastUpdated)),
      1000,
    );
    return () => clearInterval(id);
  }, [lastUpdated]);

  return (
    <span className="tabular-nums opacity-80">{formatElapsed(elapsed)}</span>
  );
}
