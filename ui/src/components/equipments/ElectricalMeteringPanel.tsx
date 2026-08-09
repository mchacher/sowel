import { useTranslation } from "react-i18next";
import { Activity, Gauge, Percent, PlugZap, Zap } from "lucide-react";
import type { DataBindingWithValue } from "../../types";
import {
  pickLivePowerW,
  pickVoltageV,
  pickCurrentA,
  pickPowerFactor,
  formatWatts,
} from "../../lib/energy-meter-display";

interface ElectricalMeteringPanelProps {
  bindings: DataBindingWithValue[];
}

interface LiveMeasure {
  key: string;
  labelKey: string;
  icon: React.ReactNode;
  value: string | null;
  unit: string;
}

/**
 * Live electrical measures of an energy meter (issue #376): power, voltage,
 * current and power factor. Each tile renders only when the corresponding
 * data is bound; the panel disappears entirely when nothing is bound.
 * Values update live through the WS store like the rest of the page.
 */
export function ElectricalMeteringPanel({ bindings }: ElectricalMeteringPanelProps) {
  const { t } = useTranslation();

  const liveW = pickLivePowerW(bindings);
  const voltageV = pickVoltageV(bindings);
  const currentA = pickCurrentA(bindings);
  const powerFactor = pickPowerFactor(bindings);
  const power = liveW !== null ? formatWatts(liveW) : null;

  const measures: LiveMeasure[] = [
    {
      key: "power",
      labelKey: "category.power",
      icon: <Zap size={16} strokeWidth={1.5} />,
      value: power?.value ?? null,
      unit: power?.unit ?? "W",
    },
    {
      key: "voltage",
      labelKey: "category.voltage",
      icon: <PlugZap size={16} strokeWidth={1.5} />,
      value: voltageV !== null ? voltageV.toFixed(1) : null,
      unit: "V",
    },
    {
      key: "current",
      labelKey: "category.current",
      icon: <Activity size={16} strokeWidth={1.5} />,
      value: currentA !== null ? currentA.toFixed(2) : null,
      unit: "A",
    },
    {
      key: "powerFactor",
      labelKey: "energy.powerFactor",
      icon: <Percent size={16} strokeWidth={1.5} />,
      value: powerFactor !== null ? powerFactor.toFixed(2) : null,
      unit: "",
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
                  <span className="text-[20px] font-semibold text-text font-mono leading-none">
                    {m.value}
                  </span>
                  {m.unit && <span className="text-[12px] text-text-tertiary">{m.unit}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
