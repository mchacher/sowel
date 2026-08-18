import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";
import { type Speed, vmcSpeedOf } from "./vmcSpeed";

interface VmcControlProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  compact?: boolean;
}

/**
 * Spec 153 — VMC speed selector. Sends a single `speed` order (off/v1/v2); the
 * backend decomposes it into safe, break-before-make relay orders. When the VMC
 * has no high-speed relay bound it is a plain OFF/ON control.
 */
export function VmcControl({ equipment, onExecuteOrder, compact }: VmcControlProps) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState<Speed | null>(null);

  const hasHigh = equipment.orderBindings.some((ob) => ob.alias === "high");
  const current = vmcSpeedOf(equipment);

  const options: { speed: Speed; label: string }[] = [
    { speed: "off", label: t("equipments.vmc.off") },
    { speed: "v1", label: hasHigh ? t("equipments.vmc.v1") : t("equipments.vmc.on") },
    ...(hasHigh ? [{ speed: "v2" as Speed, label: t("equipments.vmc.v2") }] : []),
  ];

  const setSpeed = async (speed: Speed) => {
    if (executing) return;
    setExecuting(speed);
    try {
      await onExecuteOrder("speed", speed);
    } finally {
      setExecuting(null);
    }
  };

  return (
    <div
      className={`flex items-center gap-1 ${compact ? "" : "mt-2"}`}
      onClick={(e) => e.stopPropagation()}
    >
      {options.map(({ speed, label }) => {
        const active = current === speed;
        return (
          <button
            key={speed}
            type="button"
            onClick={() => setSpeed(speed)}
            disabled={!!executing}
            aria-pressed={active}
            className={`
              flex-1 min-w-[44px] px-3 py-1.5 rounded-md text-[13px] font-medium
              flex items-center justify-center gap-1 transition-colors
              ${
                active
                  ? "bg-primary text-white"
                  : "bg-primary-light text-primary hover:bg-primary/10"
              }
              ${executing ? "opacity-60" : ""}
            `}
          >
            {executing === speed ? <Loader2 size={14} className="animate-spin" /> : label}
          </button>
        );
      })}
    </div>
  );
}
