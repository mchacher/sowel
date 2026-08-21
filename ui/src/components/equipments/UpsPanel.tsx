/**
 * UpsPanel (spec 156) — read-only detail panel for a UPS equipment.
 *
 * The type has no order surface on purpose: an accidental shutdown order to a
 * UPS is unrecoverable, and the orderly-shutdown chain belongs to `upsmon` on
 * each protected host, not to a home automation engine.
 *
 * Polymorphic like the equipment type: only the bound rows render, so a cheap
 * unit reporting a status and a charge percentage looks intentional rather
 * than broken.
 */

import { useTranslation } from "react-i18next";
import {
  BatteryCharging,
  BatteryMedium,
  Clock,
  Gauge,
  Plug,
  Zap,
} from "lucide-react";
import type { DataBindingWithValue, DataCategory } from "../../types";
import { formatRuntime, upsSeverityOf, upsStatusKey, type UpsSeverity } from "./upsStatus";
import { UPS_STATUS_VALUES, type UpsStatus } from "../../lib/ups";

interface UpsPanelProps {
  dataBindings: DataBindingWithValue[];
}

/** Reading order: what is happening, then how much runway, then the details. */
const ROW_ORDER: DataCategory[] = [
  "battery",
  "battery_runtime",
  "ups_load",
  "voltage",
  "temperature_device",
];

const SEVERITY_CLASSES: Record<UpsSeverity, string> = {
  ok: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  error: "bg-error/10 text-error",
  unknown: "bg-border-light text-text-secondary",
};

function iconFor(category: DataCategory) {
  const cls = "text-text-tertiary";
  switch (category) {
    case "battery":
      return <BatteryMedium size={16} strokeWidth={1.5} className={cls} />;
    case "battery_runtime":
      return <Clock size={16} strokeWidth={1.5} className={cls} />;
    case "ups_load":
      return <Gauge size={16} strokeWidth={1.5} className={cls} />;
    case "voltage":
      return <Plug size={16} strokeWidth={1.5} className={cls} />;
    default:
      return <Zap size={16} strokeWidth={1.5} className={cls} />;
  }
}

function formatValue(binding: DataBindingWithValue): string {
  const { category, value, unit } = binding;
  if (value === null || value === undefined || value === "") return "—";
  if (category === "battery_runtime") return formatRuntime(value) ?? String(value);
  if (category === "battery" || category === "ups_load") return `${value} %`;
  if (unit) return `${value} ${unit}`;
  return String(value);
}

function isUpsStatus(value: unknown): value is UpsStatus {
  return typeof value === "string" && (UPS_STATUS_VALUES as readonly string[]).includes(value);
}

export function UpsPanel({ dataBindings }: UpsPanelProps) {
  const { t } = useTranslation();

  const statusBinding = dataBindings.find((b) => b.category === "ups_status");
  const rawStatus =
    statusBinding?.value === null || statusBinding?.value === undefined
      ? null
      : String(statusBinding.value);
  const status = isUpsStatus(rawStatus) ? rawStatus : null;
  const severity = upsSeverityOf(status);

  // Several bindings can share a category — a UPS reports both an input and a
  // battery voltage. Keep them all, and let the alias distinguish them.
  const rows = ROW_ORDER.flatMap((category) =>
    dataBindings.filter((b) => b.category === category),
  );

  // Anything the plugin exposes beyond the canonical categories (charging
  // flag, self-test result, model, firmware…). Shown last so the extra detail
  // never pushes the state off the top of the panel.
  const extras = dataBindings.filter(
    (b) => b.category === "generic" && b !== statusBinding,
  );

  return (
    <div className="bg-surface rounded-[10px] border border-border p-4 mb-6">
      <h3 className="text-[14px] font-semibold text-text flex items-center gap-2 mb-4">
        <BatteryCharging size={16} strokeWidth={1.5} className="text-text-tertiary" />
        {t("equipments.ups.panel.title")}
      </h3>

      <div className="mb-4">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium ${SEVERITY_CLASSES[severity]}`}
          role="status"
        >
          {status ? t(upsStatusKey(status)) : (rawStatus ?? t(upsStatusKey(null)))}
        </span>
      </div>

      {rows.length === 0 && extras.length === 0 ? (
        <p className="text-[13px] text-text-tertiary">{t("equipments.ups.panel.noData")}</p>
      ) : (
        <div className="divide-y divide-border-light">
          {[...rows, ...extras].map((binding) => (
            <div key={binding.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
              {iconFor(binding.category)}
              <span className="flex-1 text-[13px] text-text">{binding.alias}</span>
              <span className="text-[13px] font-mono text-text-secondary">
                {formatValue(binding)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
