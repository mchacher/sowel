import { useTranslation } from "react-i18next";
import { Activity, Gauge, PlugZap, Zap } from "lucide-react";
import type { DataBindingWithValue, DataCategory } from "../../types";
import { formatMeasurement, sortMeasurements } from "../../lib/energy-meter-display";
import { Sparkline } from "../history/Sparkline";

/** Measurement categories with continuous numeric data → sparkline. */
const SPARKLINE_CATEGORIES = new Set<DataCategory>(["power", "voltage", "current", "energy"]);

const CATEGORY_ICONS: Partial<Record<DataCategory, React.ReactNode>> = {
  power: <Zap size={16} strokeWidth={1.5} />,
  voltage: <PlugZap size={16} strokeWidth={1.5} />,
  current: <Activity size={16} strokeWidth={1.5} />,
  energy: <Gauge size={16} strokeWidth={1.5} />,
};

interface EnergyMeasurementsPanelProps {
  bindings: DataBindingWithValue[];
  equipmentId: string;
}

/**
 * All bound measurements of an energy meter (issue #376): power, voltage,
 * current, energy indexes, and anything else bound (e.g. apparent power in
 * VA arriving as `generic`). One row per binding, live via the WS store.
 */
export function EnergyMeasurementsPanel({ bindings, equipmentId }: EnergyMeasurementsPanelProps) {
  const { t } = useTranslation();
  const measurements = sortMeasurements(bindings);

  if (measurements.length === 0) return null;

  // Aliases only disambiguate when a category has several bindings
  // (e.g. energy_forward / energy_reverse) or when the category label
  // is meaningless (generic).
  const categoryCounts = new Map<DataCategory, number>();
  for (const b of measurements) {
    categoryCounts.set(b.category, (categoryCounts.get(b.category) ?? 0) + 1);
  }

  return (
    <div className="bg-surface rounded-[10px] border border-border p-4 mb-6">
      <h3 className="text-[14px] font-semibold text-text flex items-center gap-2 mb-4">
        <Gauge size={16} strokeWidth={1.5} className="text-accent" />
        {t("energy.measurements")}
      </h3>
      <div className="space-y-3">
        {measurements.map((b) => {
          const formatted = formatMeasurement(b);
          const isGeneric = !(b.category in CATEGORY_ICONS);
          const label = isGeneric ? b.alias : t(`category.${b.category}`);
          const sublabel = !isGeneric && (categoryCounts.get(b.category) ?? 0) > 1 ? b.alias : null;
          return (
            <div
              key={b.id}
              className="flex items-center gap-3 px-3 py-3 rounded-[8px] bg-border-light/50"
            >
              <div className="flex-shrink-0 w-10 h-10 rounded-[6px] flex items-center justify-center bg-accent/10 text-accent">
                {CATEGORY_ICONS[b.category] ?? <Gauge size={16} strokeWidth={1.5} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-text-secondary truncate">{label}</div>
                {sublabel && (
                  <div className="text-[11px] text-text-tertiary font-mono truncate">{sublabel}</div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="text-right">
                  <span className="text-[22px] font-semibold text-text font-mono leading-none">
                    {formatted.value}
                  </span>
                  {formatted.unit && (
                    <span className="text-[13px] text-text-tertiary ml-1">{formatted.unit}</span>
                  )}
                </div>
                {SPARKLINE_CATEGORIES.has(b.category) && (
                  <Sparkline equipmentId={equipmentId} alias={b.alias} width={80} height={28} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
