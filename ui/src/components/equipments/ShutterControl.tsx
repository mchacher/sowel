import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronUp, Square, ChevronDown } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";
import { useSliderOverride } from "../../hooks/useSliderOverride";

interface ShutterControlProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  compact?: boolean;
}

export function ShutterControl({ equipment, onExecuteOrder, compact }: ShutterControlProps) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);
  const slider = useSliderOverride();

  const positionBinding = equipment.dataBindings.find(
    (db) => db.category === "shutter_position" || db.alias === "position",
  );
  const devicePosition = positionBinding && typeof positionBinding.value === "number"
    ? positionBinding.value
    : null;

  const position = slider.displayValue(devicePosition);

  const hasState = equipment.orderBindings.some((ob) => ob.alias === "state");
  const hasPositionOrder = equipment.orderBindings.some((ob) => ob.alias === "position");

  const handleCommand = async (command: "OPEN" | "STOP" | "CLOSE", e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (executing || !hasState) return;
    setExecuting(true);
    try {
      await onExecuteOrder("state", command);
    } finally {
      setExecuting(false);
    }
  };

  const handlePositionCommit = () =>
    slider.onCommit((v) => onExecuteOrder("position", v));

  if (compact) {
    return (
      <div
        className="flex items-center gap-2 flex-shrink-0"
        onClick={(e) => e.preventDefault()}
      >
        {hasPositionOrder && position !== null && (
          <div className="flex items-center gap-1.5">
            <input
              type="range"
              min={0}
              max={100}
              value={position}
              onPointerDown={(e) => { e.stopPropagation(); slider.onStart(); }}
              onChange={(e) => { e.stopPropagation(); slider.onChange(Number(e.target.value)); }}
              onMouseUp={handlePositionCommit}
              onTouchEnd={handlePositionCommit}
              onClick={(e) => e.stopPropagation()}
              className="w-[60px]"
            />
            <span className="text-[11px] text-text-tertiary w-8 text-right tabular-nums">
              {position}%
            </span>
          </div>
        )}
        {!hasPositionOrder && position !== null && (
          <span className="text-[13px] text-text-secondary tabular-nums text-right">
            {position === 0
              ? t("controls.closed")
              : position === 100
                ? t("controls.opened")
                : `${position}%`}
          </span>
        )}
        {hasState && (
          <>
            <div className="w-px h-5 bg-border" />
            <button
              onClick={(e) => handleCommand("OPEN", e)}
              disabled={executing}
              className="p-1.5 rounded-[5px] transition-colors duration-150 cursor-pointer bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              title={t("controls.open")}
            >
              <ChevronUp size={14} strokeWidth={1.5} />
            </button>
            <button
              onClick={(e) => handleCommand("STOP", e)}
              disabled={executing}
              className="p-1.5 rounded-[5px] transition-colors duration-150 cursor-pointer bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              title={t("controls.stop")}
            >
              <Square size={10} strokeWidth={2} />
            </button>
            <button
              onClick={(e) => handleCommand("CLOSE", e)}
              disabled={executing}
              className="p-1.5 rounded-[5px] transition-colors duration-150 cursor-pointer bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              title={t("controls.close")}
            >
              <ChevronDown size={14} strokeWidth={1.5} />
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Position slider or display */}
      {position !== null && (
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-text-tertiary w-16">{t("controls.position")}</span>
          {hasPositionOrder ? (
            <input
              type="range"
              min={0}
              max={100}
              value={position}
              onPointerDown={slider.onStart}
              onChange={(e) => slider.onChange(Number(e.target.value))}
              onMouseUp={handlePositionCommit}
              onTouchEnd={handlePositionCommit}
              className="flex-1"
            />
          ) : (
            <div className="flex-1 h-1.5 bg-border-light rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${position}%` }}
              />
            </div>
          )}
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
