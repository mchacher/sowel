import { useTranslation } from "react-i18next";
import { Activity, Gauge, Percent, PlugZap, Zap } from "lucide-react";
import type { DataBindingWithValue, EquipmentWithDetails } from "../../types";
import {
  pickLivePowerBinding,
  pickVoltageV,
  pickCurrentA,
  pickPowerFactor,
  formatWatts,
} from "../../lib/energy-meter-display";
import { resolvePowerReading } from "../../lib/power-reading";
import { formatRelative } from "../../lib/format-relative";

interface ElectricalMeteringPanelProps {
  equipment: EquipmentWithDetails;
}

interface LiveMeasure {
  key: string;
  labelKey: string;
  icon: React.ReactNode;
  value: string | null;
  unit: string;
  /** Why the value is a dash, when it is one (#839). */
  sublabel?: string | null;
}

/**
 * Live electrical measures of an energy meter (issue #376): power, voltage,
 * current and power factor. Each tile renders only when the corresponding
 * data is bound; the panel disappears entirely when nothing is bound.
 * Values update live through the WS store like the rest of the page.
 */
export function ElectricalMeteringPanel({ equipment }: ElectricalMeteringPanelProps) {
  const { t } = useTranslation();

  const bindings = equipment.dataBindings;
  // #839 — the panel takes the equipment rather than bare bindings because the
  // freshness budget is a property of the equipment's type, not of the value.
  const powerBinding = pickLivePowerBinding(bindings);
  const liveReading = resolvePowerReading(equipment, powerBinding);
  const liveW = liveReading.watts;
  const outdated = liveReading.verdict === "stale";
  const power = liveW !== null ? formatWatts(liveW) : null;

  // Freshness is a property of the reading GROUP, not of the wattage alone.
  // These four measures come off one meter through one radio, so the silence
  // that aged the power aged the volts and amps beside it. Dashing the power
  // while drawing `231.0 V / 5.40 A / 0.98` at full strength would present
  // three figures as live on the strength of a reading just refused — the
  // same argument solarWidget.ts makes for its own line. Scoped to the power
  // binding's own device, so a meter fed by two devices only blanks the half
  // that actually went quiet.
  const agedWith = (b: DataBindingWithValue | undefined): boolean =>
    outdated && !!powerBinding && !!b && b.deviceId === powerBinding.deviceId;

  const byCategory = (category: string) => bindings.find((b) => b.category === category);
  const pfBinding = bindings.find((b) => b.alias === "power_factor" || b.alias === "pf");

  const voltageAged = agedWith(byCategory("voltage"));
  const currentAged = agedWith(byCategory("current"));
  const pfAged = agedWith(pfBinding);

  const voltageV = pickVoltageV(bindings);
  const currentA = pickCurrentA(bindings);
  const powerFactor = pickPowerFactor(bindings);

  const measures: LiveMeasure[] = [
    {
      key: "power",
      labelKey: "category.power",
      icon: <Zap size={16} strokeWidth={1.5} />,
      value: outdated ? "—" : (power?.value ?? null),
      unit: outdated ? "" : (power?.unit ?? "W"),
      sublabel: outdated
        ? `${t("reading.outdated")} · ${t("reading.ago", { age: formatRelative(liveReading.since, t) })}`
        : null,
    },
    {
      key: "voltage",
      labelKey: "category.voltage",
      icon: <PlugZap size={16} strokeWidth={1.5} />,
      value: voltageAged ? "—" : voltageV !== null ? voltageV.toFixed(1) : null,
      unit: voltageAged ? "" : "V",
      sublabel: voltageAged ? t("reading.outdated") : null,
    },
    {
      key: "current",
      labelKey: "category.current",
      icon: <Activity size={16} strokeWidth={1.5} />,
      value: currentAged ? "—" : currentA !== null ? currentA.toFixed(2) : null,
      unit: currentAged ? "" : "A",
      sublabel: currentAged ? t("reading.outdated") : null,
    },
    {
      key: "powerFactor",
      labelKey: "energy.powerFactor",
      icon: <Percent size={16} strokeWidth={1.5} />,
      value: pfAged ? "—" : powerFactor !== null ? powerFactor.toFixed(2) : null,
      unit: "",
      sublabel: pfAged ? t("reading.outdated") : null,
    },
  ];

  if (measures.every((m) => m.value === null)) return null;

  return (
    <div className="bg-surface rounded-[10px] border border-border p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[14px] font-semibold text-text flex items-center gap-2">
          <Gauge size={16} strokeWidth={1.5} className="text-accent" />
          {t("energy.electricalMetering")}
        </h3>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {measures.map((m) => {
          if (m.value === null) return null;
          return (
            <div
              key={m.key}
              className="flex items-center gap-3 px-3 py-3 rounded-[8px] bg-border-light/50"
            >
              <div className="flex-shrink-0 w-10 h-10 rounded-[6px] flex items-center justify-center bg-accent/10 text-accent">
                {m.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-text-tertiary">{t(m.labelKey)}</div>
                <div className="flex items-baseline gap-1">
                  <span
                    className={`text-[20px] font-semibold font-mono leading-none ${
                      m.sublabel ? "text-text-tertiary" : "text-text"
                    }`}
                  >
                    {m.value}
                  </span>
                  {m.unit && <span className="text-[12px] text-text-tertiary">{m.unit}</span>}
                </div>
                {m.sublabel && (
                  <div className="text-[11px] text-text-tertiary truncate">{m.sublabel}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
