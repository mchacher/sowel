import { useTranslation } from "react-i18next";
import type { DataBindingWithValue, DataCategory } from "../../types";
import { SolarPanelIcon } from "../icons/SolarPanelIcon";
import { EquipmentStatusBadge } from "./EquipmentStatusBadge";
import type { EquipmentStatus, EquipmentStatusReason } from "../../types";
import { formatEnergy, formatPower, formatTemperature, formatWithUnit } from "../../lib/format";

/**
 * Solar panel detail panel (spec 125). Lists a PV panel's per-channel metrics
 * (DC power / energy / voltage / current) plus the shared inverter temperature.
 * Read-only — solar panels accept no orders.
 */

interface SolarPanelDataPanelProps {
  bindings: DataBindingWithValue[];
  status: EquipmentStatus;
  statusReason?: EquipmentStatusReason;
}

/** Display order + i18n label key for each solar metric category. */
const METRIC_ORDER: { category: DataCategory; labelKey: string }[] = [
  { category: "power", labelKey: "category.power" },
  { category: "energy", labelKey: "category.energy" },
  { category: "voltage", labelKey: "category.voltage" },
  { category: "current", labelKey: "category.current" },
  { category: "temperature_device", labelKey: "category.temperature_device" },
];

function formatMetric(category: DataCategory, value: unknown, unit?: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (category === "power") return formatPower(value);
  if (category === "energy") return formatEnergy(value / 1000, { unit: "auto" });
  if (category === "temperature_device") return formatTemperature(value);
  return formatWithUnit(value, unit);
}

export function SolarPanelDataPanel({ bindings, status, statusReason }: SolarPanelDataPanelProps) {
  const { t } = useTranslation();

  const rows = METRIC_ORDER.map(({ category, labelKey }) => {
    const binding = bindings.find((b) => b.category === category);
    if (!binding) return null;
    return {
      key: category,
      label: t(labelKey),
      display: formatMetric(category, binding.value, binding.unit),
    };
  }).filter((r): r is { key: DataCategory; label: string; display: string } => r !== null);

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-body font-semibold text-text flex items-center gap-2">
          <SolarPanelIcon size={16} strokeWidth={1.5} className="text-primary" />
          {t("solar.title")}
        </h3>
        <EquipmentStatusBadge status={status} reason={statusReason} size="sm" />
      </div>
      {rows.length === 0 ? (
        <p className="text-small text-text-tertiary">{t("sensors.noData")}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center justify-between">
              <span className="text-small text-text-secondary">{r.label}</span>
              <span className="text-body font-semibold text-text tabular-nums">{r.display}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
