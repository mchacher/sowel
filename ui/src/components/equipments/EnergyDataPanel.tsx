import { useTranslation } from "react-i18next";
import { Zap, Clock, Calendar, CalendarDays, CalendarRange } from "lucide-react";
import type { ComputedDataEntry, EquipmentStatus, EquipmentStatusReason } from "../../types";
import { EquipmentStatusBadge } from "./EquipmentStatusBadge";

interface EnergyDataPanelProps {
  computedData: ComputedDataEntry[];
  /** Spec 116: render a badge + last-update caption when degraded/offline. */
  status?: EquipmentStatus;
  statusReason?: EquipmentStatusReason;
}

interface EnergyCumul {
  alias: string;
  labelKey: string;
  icon: React.ReactNode;
  value: number | null;
}

function formatEnergy(wh: number): { value: string; unit: string } {
  if (wh >= 1000) return { value: (wh / 1000).toFixed(2), unit: "kWh" };
  return { value: String(Math.round(wh)), unit: "Wh" };
}

function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T").replace("Z", "") + "Z";
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) return "";
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} j`;
}

export function EnergyDataPanel({ computedData, status, statusReason }: EnergyDataPanelProps) {
  const { t } = useTranslation();

  const cumuls: EnergyCumul[] = [
    {
      alias: "energy_hour",
      labelKey: "energy.cumul.hour",
      icon: <Clock size={16} strokeWidth={1.5} />,
      value: getNumericValue(computedData, "energy_hour"),
    },
    {
      alias: "energy_day",
      labelKey: "energy.cumul.day",
      icon: <Calendar size={16} strokeWidth={1.5} />,
      value: getNumericValue(computedData, "energy_day"),
    },
    {
      alias: "energy_month",
      labelKey: "energy.cumul.month",
      icon: <CalendarDays size={16} strokeWidth={1.5} />,
      value: getNumericValue(computedData, "energy_month"),
    },
    {
      alias: "energy_year",
      labelKey: "energy.cumul.year",
      icon: <CalendarRange size={16} strokeWidth={1.5} />,
      value: getNumericValue(computedData, "energy_year"),
    },
  ];

  // Only render if at least one energy cumul exists
  if (cumuls.every((c) => c.value === null)) return null;

  const isDegraded = status === "degraded" || status === "offline";

  return (
    <div className="bg-surface rounded-[10px] border border-border p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[14px] font-semibold text-text flex items-center gap-2">
          <Zap size={16} strokeWidth={1.5} className="text-accent" />
          {t("energy.cumuls")}
        </h3>
        {status && <EquipmentStatusBadge status={status} reason={statusReason} size="sm" />}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {cumuls.map((c) => {
          if (c.value === null) return null;
          const formatted = formatEnergy(c.value);
          return (
            <div
              key={c.alias}
              className="flex items-center gap-3 px-3 py-3 rounded-[8px] bg-border-light/50"
            >
              <div className="flex-shrink-0 w-10 h-10 rounded-[6px] flex items-center justify-center bg-accent/10 text-accent">
                {c.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-text-tertiary">{t(c.labelKey)}</div>
                <div className="flex items-baseline gap-1">
                  <span className="text-[20px] font-semibold text-text font-mono leading-none">
                    {formatted.value}
                  </span>
                  <span className="text-[12px] text-text-tertiary">{formatted.unit}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {isDegraded && statusReason?.offlineSince && (
        <div
          className={`mt-3 text-center text-[11px] font-mono ${status === "offline" ? "text-error" : "text-text-tertiary"}`}
        >
          {status === "offline"
            ? t("energy.cumul.offlineSince", { when: formatRelative(statusReason.offlineSince) })
            : t("energy.cumul.lastLive", { when: formatRelative(statusReason.offlineSince) })}
        </div>
      )}
    </div>
  );
}

function getNumericValue(data: ComputedDataEntry[], alias: string): number | null {
  const entry = data.find((d) => d.alias === alias);
  if (!entry || typeof entry.value !== "number") return null;
  return entry.value;
}
