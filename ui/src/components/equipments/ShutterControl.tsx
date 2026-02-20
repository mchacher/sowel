import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronUp, Square, ChevronDown } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";

interface ShutterControlProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
}

export function ShutterControl({ equipment, onExecuteOrder }: ShutterControlProps) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);

  const positionBinding = equipment.dataBindings.find(
    (db) => db.category === "shutter_position"
  );
  const position = positionBinding && typeof positionBinding.value === "number"
    ? positionBinding.value
    : null;

  const hasState = equipment.orderBindings.some((ob) => ob.alias === "state");

  const handleCommand = async (command: "OPEN" | "STOP" | "CLOSE") => {
    if (executing || !hasState) return;
    setExecuting(true);
    try {
      await onExecuteOrder("state", command);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Position display */}
      {position !== null && (
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-text-tertiary w-16">{t("controls.position")}</span>
          <div className="flex-1 h-1.5 bg-border-light rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${position}%` }}
            />
          </div>
          <span className="text-[12px] text-text-secondary w-auto text-right tabular-nums">
            {position === 0 ? t("controls.closed") : position === 100 ? t("controls.opened") : `${position}%`}
          </span>
        </div>
      )}

      {/* Command buttons */}
      {hasState && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleCommand("OPEN")}
            disabled={executing}
            className="flex items-center gap-2 px-4 py-2 rounded-[6px] text-[13px] font-medium transition-colors duration-150 bg-border-light text-text-secondary hover:bg-border hover:text-text disabled:opacity-50"
          >
            <ChevronUp size={16} strokeWidth={1.5} />
            {t("controls.open")}
          </button>
          <button
            onClick={() => handleCommand("STOP")}
            disabled={executing}
            className="flex items-center gap-2 px-4 py-2 rounded-[6px] text-[13px] font-medium transition-colors duration-150 bg-border-light text-text-secondary hover:bg-border hover:text-text disabled:opacity-50"
          >
            <Square size={12} strokeWidth={2} />
            {t("controls.stop")}
          </button>
          <button
            onClick={() => handleCommand("CLOSE")}
            disabled={executing}
            className="flex items-center gap-2 px-4 py-2 rounded-[6px] text-[13px] font-medium transition-colors duration-150 bg-border-light text-text-secondary hover:bg-border hover:text-text disabled:opacity-50"
          >
            <ChevronDown size={16} strokeWidth={1.5} />
            {t("controls.close")}
          </button>
        </div>
      )}
    </div>
  );
}
