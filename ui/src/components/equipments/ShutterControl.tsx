import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Square } from "lucide-react";
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

  // Resolve the move + position-set bindings by category first, falling back
  // to the conventional alias (`state`, `position`) and finally to any
  // shutter-flavoured key. This matches EquipmentWidget's resolver and lets
  // manually-rebound shutters (where alias defaults to the device key like
  // `shutter_state`) keep working in the compact zone view and detail page.
  const moveBinding =
    equipment.orderBindings.find(
      (ob) => ob.category === "pool_cover_move" || ob.category === "shutter_move",
    ) ??
    equipment.orderBindings.find(
      (ob) => ob.alias === "state" || /shutter\d*_state/.test(ob.alias),
    );
  const positionOrderBinding =
    equipment.orderBindings.find((ob) => ob.category === "set_shutter_position") ??
    equipment.orderBindings.find(
      (ob) => ob.alias === "position" || /shutter\d*_position/.test(ob.alias),
    );

  const hasState = !!moveBinding;
  const hasPositionOrder = !!positionOrderBinding;

  // Pool covers slide horizontally → ←/→ arrows. Window shutters and awnings keep ↑/↓.
  const isHorizontal = equipment.type === "pool_cover";
  const isAwning = equipment.type === "awning";
  const OpenIcon = isHorizontal ? ChevronLeft : ChevronUp;
  const CloseIcon = isHorizontal ? ChevronRight : ChevronDown;

  // Awning relabels:
  //   OPEN (RF up) = retract  · CLOSE (RF down) = extend (deploy)
  //   pos 0  = retracted    · pos 100 = deployed
  // The control wiring stays identical to a shutter — only the user-facing
  // vocabulary changes.
  const openKey = isAwning ? "controls.retract" : "controls.open";
  const closeKey = isAwning ? "controls.extend" : "controls.close";
  const pillAtZeroKey = isAwning ? "controls.retracted" : "controls.closed";
  const pillAtHundredKey = isAwning ? "controls.deployed" : "controls.opened";

  const handleCommand = async (command: "OPEN" | "STOP" | "CLOSE", e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (executing || !moveBinding) return;
    setExecuting(true);
    try {
      const enumMatch = moveBinding.enumValues?.find((v) => v.toUpperCase() === command);
      await onExecuteOrder(moveBinding.alias, enumMatch ?? command);
    } finally {
      setExecuting(false);
    }
  };

  const handlePositionCommit = () => {
    if (!positionOrderBinding) return;
    slider.onCommit((v) => onExecuteOrder(positionOrderBinding.alias, v));
  };

  if (compact) {
    // Layout: slider (80px) → state pill → 3 bordered 24×24 buttons (.shutter-btn).
    const sttClass =
      "w-[24px] h-[24px] inline-flex items-center justify-center border border-border-light bg-surface text-text-tertiary rounded-[4px] transition-colors duration-150 cursor-pointer hover:bg-shutter-50 hover:text-shutter-500 hover:border-shutter-500 disabled:opacity-50 disabled:cursor-not-allowed";
    return (
      <div
        className="flex items-center gap-2 flex-shrink-0"
        onClick={(e) => e.preventDefault()}
      >
        {hasPositionOrder && position !== null && (
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
            className="hidden sm:block w-[80px]"
            style={{ "--fill-pct": `${position}%`, "--fill-color": "var(--shutter-500)" } as React.CSSProperties}
          />
        )}
        {position !== null && (
          position === 100 ? (
            <span className="text-[11px] font-semibold text-success px-[7px] py-[1px] rounded-full bg-success/10">
              {t(pillAtHundredKey)}
            </span>
          ) : position === 0 ? (
            <span className="text-[11px] font-semibold text-shutter-500 px-[7px] py-[1px] rounded-full bg-shutter-50">
              {t(pillAtZeroKey)}
            </span>
          ) : (
            <span className="text-[11px] text-text-tertiary tabular-nums w-8 text-right">
              {position}%
            </span>
          )
        )}
        {hasState && (
          <>
            <div className="w-px h-5 bg-border" />
            <div className="inline-flex items-center gap-[2px]">
            <button
              onClick={(e) => handleCommand("OPEN", e)}
              disabled={executing}
              className={sttClass}
              title={t(openKey)}
            >
              <OpenIcon size={10} strokeWidth={2} />
            </button>
            <button
              onClick={(e) => handleCommand("STOP", e)}
              disabled={executing}
              className={sttClass}
              title={t("controls.stop")}
            >
              <Square size={9} strokeWidth={0} fill="currentColor" />
            </button>
            <button
              onClick={(e) => handleCommand("CLOSE", e)}
              disabled={executing}
              className={sttClass}
              title={t(closeKey)}
            >
              <CloseIcon size={10} strokeWidth={2} />
            </button>
            </div>
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
              style={{ "--fill-pct": `${position}%`, "--fill-color": "var(--shutter-500)" } as React.CSSProperties}
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
            {position === 0 ? t(pillAtZeroKey) : position === 100 ? t(pillAtHundredKey) : `${position}%`}
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
            <OpenIcon size={16} strokeWidth={1.5} />
            {t(openKey)}
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
            <CloseIcon size={16} strokeWidth={1.5} />
            {t(closeKey)}
          </button>
        </div>
      )}
    </div>
  );
}
