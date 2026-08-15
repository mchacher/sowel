import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Power } from "lucide-react";
import type { EquipmentWithDetails } from "../../../types";
import { WidgetCard } from "../WidgetCard";
import type { WidgetPresentation } from "./types";

// Spec 149 — desktop renderer for a presentation descriptor. Reproduces the
// switch-family layout exactly: WidgetCard shell → centered icon + state pill
// (+ secondary lines) → bottom toggle row. The per-type derivation lives in
// resolveWidgetPresentation; this component owns only the desktop pixels.

interface PresentationWidgetProps {
  label: string;
  sublabel?: string;
  equipment: EquipmentWithDetails;
  presentation: WidgetPresentation;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
}

export function PresentationWidget({
  label,
  sublabel,
  equipment,
  presentation,
  onExecuteOrder,
}: PresentationWidgetProps) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);

  const { isActive, state } = presentation;
  const toggle = presentation.controls.find((c) => c.kind === "toggle");

  const handleToggle = async () => {
    if (executing || !toggle) return;
    setExecuting(true);
    try {
      await onExecuteOrder(toggle.alias, toggle.on ? toggle.offValue : toggle.onValue);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <WidgetCard label={label} sublabel={sublabel}>
      {/* Zone 2: icon + state */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center h-[104px] my-auto">
        <div />
        {presentation.icon({ surface: "desktop" })}
        <div className="flex flex-col items-start gap-1 pl-2">
          <span
            className={`text-[12px] font-medium px-2.5 py-0.5 rounded-full ${
              isActive ? "bg-active/10 text-active" : "bg-border-light text-text-tertiary"
            }`}
          >
            {state.primary}
          </span>
          {state.secondary?.map((line) => (
            <span key={line} className="text-[11px] text-text-tertiary tabular-nums font-mono">
              {line}
            </span>
          ))}
        </div>
      </div>

      {/* Zone 3: toggle button */}
      {toggle && equipment.enabled && (
        <div className="flex justify-center gap-3 mt-auto pt-1">
          <button
            onClick={handleToggle}
            disabled={executing}
            className={`w-10 h-10 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed ${
              toggle.on ? "!border-active/40 !text-active !bg-active/5" : ""
            }`}
            title={toggle.on ? t("controls.turnOff") : t("controls.turnOn")}
          >
            {executing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Power size={16} strokeWidth={1.5} />
            )}
          </button>
        </div>
      )}
    </WidgetCard>
  );
}
