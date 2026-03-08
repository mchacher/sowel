import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Power } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";
import { useSliderOverride } from "../../hooks/useSliderOverride";

interface LightControlProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  compact?: boolean;
}

export function LightControl({ equipment, onExecuteOrder, compact }: LightControlProps) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);
  const slider = useSliderOverride();

  const stateBinding = equipment.dataBindings.find(
    (db) => db.alias === "state" || db.category === "light_state"
  );
  const brightnessBinding = equipment.dataBindings.find(
    (db) => db.alias === "brightness" || db.category === "light_brightness"
  );

  const isOn = stateBinding
    ? stateBinding.value === true || String(stateBinding.value).toUpperCase() === "ON"
    : false;

  const deviceBrightness = brightnessBinding
    ? typeof brightnessBinding.value === "number"
      ? brightnessBinding.value
      : null
    : null;

  const brightness = slider.displayValue(deviceBrightness);

  const toggleBinding = equipment.orderBindings.find(
    (ob) => ob.type === "boolean" || (ob.alias === "state" && ob.type === "enum")
  );
  const hasToggle = !!toggleBinding;
  const hasBrightness = equipment.orderBindings.some(
    (ob) => ob.type === "number" && (ob.alias === "brightness" || ob.key === "brightness")
  );

  const handleToggle = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (executing || !toggleBinding) return;
    setExecuting(true);
    try {
      const alias = toggleBinding.alias;
      // Boolean orders use true/false; enum/state orders use the actual enum values
      const onVal = toggleBinding.enumValues?.find(v => /^on$/i.test(v)) ?? "ON";
      const offVal = toggleBinding.enumValues?.find(v => /^off$/i.test(v)) ?? "OFF";
      const value = toggleBinding.type === "boolean" && alias !== "state"
        ? !isOn
        : (isOn ? offVal : onVal);
      await onExecuteOrder(alias, value);
    } finally {
      setExecuting(false);
    }
  };

  const handleBrightnessCommit = () =>
    slider.onCommit((v) => onExecuteOrder("brightness", v));

  if (compact) {
    return (
      <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
        {hasBrightness && brightness !== null && (
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={254}
              value={brightness}
              onPointerDown={(e) => { e.stopPropagation(); slider.onStart(); }}
              onChange={(e) => slider.onChange(Number(e.target.value))}
              onMouseUp={handleBrightnessCommit}
              onTouchEnd={handleBrightnessCommit}
              onClick={(e) => e.stopPropagation()}
              className="w-[80px] slider-active"
            />
            <span className="text-[11px] text-text-tertiary w-7 text-right tabular-nums">
              {Math.round((brightness / 254) * 100)}%
            </span>
          </div>
        )}
        <div className="w-px h-5 bg-border" />
        <button
          onClick={handleToggle}
          disabled={executing || !hasToggle}
          className={`
            p-2 rounded-[6px] transition-colors duration-150 cursor-pointer
            ${isOn
              ? "bg-active text-white hover:bg-active/80"
              : "bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary"
            }
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
          title={isOn ? t("controls.turnOff") : t("controls.turnOn")}
        >
          <Power size={16} strokeWidth={1.5} />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toggle button */}
      {hasToggle && (
        <button
          onClick={handleToggle}
          disabled={executing}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-[6px] text-[13px] font-medium
            transition-colors duration-150
            ${isOn
              ? "bg-active text-white hover:bg-active/80"
              : "bg-border-light text-text-secondary hover:bg-border hover:text-text"
            }
            disabled:opacity-50
          `}
        >
          <Power size={16} strokeWidth={1.5} />
          {executing ? "..." : isOn ? t("common.on") : t("common.off")}
        </button>
      )}

      {/* Brightness slider */}
      {hasBrightness && brightness !== null && (
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-text-tertiary w-16">{t("controls.brightness")}</span>
          <input
            type="range"
            min={0}
            max={254}
            value={brightness}
            onPointerDown={slider.onStart}
            onChange={(e) => slider.onChange(Number(e.target.value))}
            onMouseUp={handleBrightnessCommit}
            onTouchEnd={handleBrightnessCommit}
            className="flex-1 slider-active"
          />
          <span className="text-[12px] text-text-secondary w-10 text-right">
            {Math.round((brightness / 254) * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}
