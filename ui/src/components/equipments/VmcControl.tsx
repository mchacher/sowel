import { useEffect, useState } from "react";
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
  // Optimistic target: going V1<->V2 the core does break-before-make, so the
  // observed speed dips through OFF for a moment. Keep the requested pill lit
  // until reality catches up (or a timeout), so that transient OFF never shows.
  const [pending, setPending] = useState<Speed | null>(null);

  const hasHigh = equipment.orderBindings.some((ob) => ob.alias === "high");
  const observed = vmcSpeedOf(equipment);
  const current = pending ?? observed;

  useEffect(() => {
    if (pending === null) return;
    if (observed === pending) {
      setPending(null);
      return;
    }
    const id = setTimeout(() => setPending(null), 6000); // safety net
    return () => clearTimeout(id);
  }, [pending, observed]);

  const options: { speed: Speed; label: string }[] = [
    { speed: "off", label: t("equipments.vmc.off") },
    { speed: "v1", label: hasHigh ? t("equipments.vmc.v1") : t("equipments.vmc.on") },
    ...(hasHigh ? [{ speed: "v2" as Speed, label: t("equipments.vmc.v2") }] : []),
  ];

  const setSpeed = async (speed: Speed) => {
    if (executing) return;
    setExecuting(speed);
    setPending(speed); // light the target immediately, hide the transient OFF
    try {
      await onExecuteOrder("speed", speed);
    } finally {
      setExecuting(null);
    }
  };

  return (
    // Compact segmented control: a neutral track with small pills sized to
    // their label, so it never stretches into full-width blocks on the detail
    // page.
    <div
      className={`inline-flex items-center gap-0.5 rounded-lg bg-border-light p-0.5 ${compact ? "" : "mt-1"}`}
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
              min-w-[42px] px-3 py-1 rounded-md text-[13px] font-medium
              flex items-center justify-center transition-colors
              ${
                active
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-secondary hover:text-primary"
              }
              ${executing ? "opacity-60" : ""}
            `}
          >
            {executing === speed ? <Loader2 size={13} className="animate-spin" /> : label}
          </button>
        );
      })}
    </div>
  );
}
