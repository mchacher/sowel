import { useState, useRef } from "react";
import { Power } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";

const SETTLE_DELAY_MS = 2000;

interface LightControlProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  compact?: boolean;
}

export function LightControl({ equipment, onExecuteOrder, compact }: LightControlProps) {
  const [executing, setExecuting] = useState(false);
  const [, forceRender] = useState(0);
  const localValue = useRef<number | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stateBinding = equipment.dataBindings.find(
    (db) => db.alias === "state" || db.category === "light_state"
  );
  const brightnessBinding = equipment.dataBindings.find(
    (db) => db.alias === "brightness" || db.category === "light_brightness"
  );

  const isOn = stateBinding
    ? stateBinding.value === true || stateBinding.value === "ON"
    : false;

  const deviceBrightness = brightnessBinding
    ? typeof brightnessBinding.value === "number"
      ? brightnessBinding.value
      : null
    : null;

  // While local override is active (dragging or settling), show local value
  const brightness = localValue.current !== null
    ? localValue.current
    : deviceBrightness;

  const hasToggle = equipment.orderBindings.some(
    (ob) => ob.alias === "state" || ob.alias === "turn_on"
  );
  const hasBrightness = equipment.orderBindings.some(
    (ob) => ob.alias === "brightness"
  );

  const handleToggle = async () => {
    if (executing || !hasToggle) return;
    setExecuting(true);
    try {
      const alias = equipment.orderBindings.find(
        (ob) => ob.alias === "state"
      )
        ? "state"
        : "turn_on";
      const value = isOn ? (alias === "state" ? "OFF" : false) : (alias === "state" ? "ON" : true);
      await onExecuteOrder(alias, value);
    } finally {
      setExecuting(false);
    }
  };

  const handleBrightnessChange = (newValue: number) => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    localValue.current = newValue;
    forceRender((n) => n + 1);
  };

  const handleBrightnessCommit = async () => {
    const commitValue = localValue.current;
    if (!hasBrightness || commitValue === null) return;
    try {
      await onExecuteOrder("brightness", commitValue);
    } catch {
      // Ignore
    }
    // Keep showing target value until device settles
    settleTimer.current = setTimeout(() => {
      localValue.current = null;
      settleTimer.current = null;
      forceRender((n) => n + 1);
    }, SETTLE_DELAY_MS);
  };

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
              onChange={(e) => handleBrightnessChange(Number(e.target.value))}
              onMouseUp={handleBrightnessCommit}
              onTouchEnd={handleBrightnessCommit}
              className="w-[80px] accent-primary h-1"
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
              ? "bg-primary text-white hover:bg-primary-hover"
              : "bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary"
            }
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
          title={isOn ? "Turn off" : "Turn on"}
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
              ? "bg-primary text-white hover:bg-primary-hover"
              : "bg-border-light text-text-secondary hover:bg-border hover:text-text"
            }
            disabled:opacity-50
          `}
        >
          <Power size={16} strokeWidth={1.5} />
          {executing ? "..." : isOn ? "ON" : "OFF"}
        </button>
      )}

      {/* Brightness slider */}
      {hasBrightness && brightness !== null && (
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-text-tertiary w-16">Brightness</span>
          <input
            type="range"
            min={0}
            max={254}
            value={brightness}
            onChange={(e) => handleBrightnessChange(Number(e.target.value))}
            onMouseUp={handleBrightnessCommit}
            onTouchEnd={handleBrightnessCommit}
            className="flex-1 accent-primary h-1.5"
          />
          <span className="text-[12px] text-text-secondary w-10 text-right">
            {Math.round((brightness / 254) * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}
