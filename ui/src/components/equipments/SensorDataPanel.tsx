import { useTranslation } from "react-i18next";
import { Gauge } from "lucide-react";
import type { DataBindingWithValue, DataCategory } from "../../types";
import {
  getSensorBindings,
  getAllBatteryBindings,
  getBatteryIcon,
  getBatteryColor,
  getSensorCategoryIcon,
  isBooleanSensorCategory,
  booleanSensorTone,
  formatBooleanSensor,
  formatSensorValue,
} from "./sensorUtils";
import { Sparkline } from "../history/Sparkline";

/** Categories that produce continuous numeric data suitable for sparklines. */
const SPARKLINE_CATEGORIES = new Set([
  "temperature", "humidity", "luminosity", "pressure",
  "power", "energy", "co2", "noise", "voltage", "current",
]);

interface SensorDataPanelProps {
  bindings: DataBindingWithValue[];
  equipmentId: string;
}

export function SensorDataPanel({ bindings, equipmentId }: SensorDataPanelProps) {
  const { t } = useTranslation();
  const sensorBindings = getSensorBindings(bindings);
  const batteryBindings = getAllBatteryBindings(bindings);

  if (sensorBindings.length === 0 && batteryBindings.length === 0) {
    return (
      <div className="bg-surface rounded-[10px] border border-border p-4 mb-6">
        <h3 className="text-body font-semibold text-text flex items-center gap-2 mb-2">
          <Gauge size={16} strokeWidth={1.5} className="text-text-tertiary" />
          {t("sensors.title")}
        </h3>
        <p className="text-small text-text-tertiary">{t("sensors.noData")}</p>
      </div>
    );
  }

  // Group bindings by category
  const byCategory = new Map<DataCategory, DataBindingWithValue[]>();
  for (const b of sensorBindings) {
    const list = byCategory.get(b.category) ?? [];
    list.push(b);
    byCategory.set(b.category, list);
  }

  return (
    <div className="bg-surface rounded-[10px] border border-border p-4 mb-6">
      <h3 className="text-body font-semibold text-text flex items-center gap-2 mb-4">
        <Gauge size={16} strokeWidth={1.5} className="text-text-tertiary" />
        {t("sensors.title")}
      </h3>
      <div className="space-y-3">
        {[...byCategory.entries()].map(([category, categoryBindings]) => (
          <SensorCategoryRow
            key={category}
            category={category}
            bindings={categoryBindings}
            equipmentId={equipmentId}
          />
        ))}
        {batteryBindings.map((b) => {
          const level = typeof b.value === "number" ? b.value : null;
          return (
            <BatteryRow
              key={b.id}
              level={level}
              deviceName={batteryBindings.length > 1 ? b.deviceName : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

function SensorCategoryRow({
  category,
  bindings,
  equipmentId,
}: {
  category: DataCategory;
  bindings: DataBindingWithValue[];
  equipmentId: string;
}) {
  const { t } = useTranslation();
  const isBoolean = isBooleanSensorCategory(category);
  const label = t(`category.${category}`);

  return (
    <div className="flex items-center gap-3 px-3 py-3 rounded-[8px] bg-border-light/50">
      {/* Category icon */}
      <div
        className={`
          flex-shrink-0 w-10 h-10 rounded-[6px] flex items-center justify-center
          ${getRowIconColor(category, bindings)}
        `}
      >
        {getSensorCategoryIcon(category, bindings[0]?.value)}
      </div>

      {/* Label */}
      <div className="flex-1 min-w-0">
        <div className="text-small font-medium text-text-secondary">{label}</div>
        {bindings.length > 1 && (
          <div className="text-micro text-text-tertiary">
            {t("sensors.sources", { count: bindings.length })}
          </div>
        )}
      </div>

      {/* Values */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {isBoolean ? (
          <BooleanSensorValue category={category} bindings={bindings} />
        ) : (
          <NumericSensorValues bindings={bindings} equipmentId={equipmentId} />
        )}
      </div>
    </div>
  );
}

function BooleanSensorValue({
  category,
  bindings,
}: {
  category: DataCategory;
  bindings: DataBindingWithValue[];
}) {
  const { t } = useTranslation();
  // For boolean sensors, OR logic: active if any binding is active
  const isActive = bindings.some(
    (b) => b.value === true || b.value === "ON",
  );
  // Contact: inverted (contact=false means open)
  const isContactCategory = category === "contact_door" || category === "contact_window";
  const isContactOpen = isContactCategory && bindings.some(
    (b) => b.value === false || b.value === "OFF",
  );
  const displayActive = isContactCategory ? isContactOpen : isActive;
  const text = formatBooleanSensor(category, bindings[0]?.value, t);
  const tone = booleanSensorTone(category, displayActive);

  return (
    <div className="flex items-center gap-2">
      <span
        className={`
          text-body font-semibold tabular-nums
          ${tone.text}
        `}
      >
        {text}
      </span>
      <div
        className={`
          w-2.5 h-2.5 rounded-full
          ${tone.dot}
        `}
      />
    </div>
  );
}

function NumericSensorValues({ bindings, equipmentId }: { bindings: DataBindingWithValue[]; equipmentId: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3">
      {bindings.map((b) => (
        <div key={b.id} className="flex items-center gap-2">
          <div className="text-right">
            <span className="text-title font-semibold text-text tabular-nums leading-none">
              {formatSensorValue(b.value, undefined, t)}
            </span>
            {b.unit && (
              <span className="text-small text-text-tertiary ml-1">{b.unit}</span>
            )}
          </div>
          {SPARKLINE_CATEGORIES.has(b.category) && (
            <Sparkline equipmentId={equipmentId} alias={b.alias} width={80} height={28} />
          )}
        </div>
      ))}
    </div>
  );
}

function BatteryRow({ level, deviceName }: { level: number | null; deviceName?: string }) {
  const { t } = useTranslation();
  const color = getBatteryColor(level);
  return (
    <div className="flex items-center gap-3 px-3 py-3 rounded-[8px] bg-border-light/50">
      <div className={`flex-shrink-0 w-10 h-10 rounded-[6px] flex items-center justify-center bg-border-light ${color}`}>
        {getBatteryIcon(level, 18, 1.5)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-small font-medium text-text-secondary">{t("sensors.battery")}</div>
        {deviceName && (
          <div className="text-micro text-text-tertiary truncate">{deviceName}</div>
        )}
      </div>
      <div className="flex items-baseline gap-1 flex-shrink-0">
        <span className={`text-title font-semibold tabular-nums leading-none ${color}`}>
          {level !== null ? level : "\u2014"}
        </span>
        <span className="text-small text-text-tertiary">%</span>
      </div>
    </div>
  );
}

function getRowIconColor(category: DataCategory, bindings: DataBindingWithValue[]): string {
  if (category === "motion") {
    const active = bindings.some((b) => b.value === true || b.value === "ON");
    return booleanSensorTone(category, active).pill;
  }
  if (category === "contact_door" || category === "contact_window") {
    const open = bindings.some((b) => b.value === false || b.value === "OFF");
    return booleanSensorTone(category, open).pill;
  }
  if (category === "water_leak" || category === "smoke") {
    const active = bindings.some((b) => b.value === true || b.value === "ON");
    return booleanSensorTone(category, active).pill;
  }
  return "bg-primary/10 text-primary";
}
