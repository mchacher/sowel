import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Flame, Snowflake, Loader2 } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";

interface HeaterControlProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  compact?: boolean;
}

export function HeaterControl({ equipment, onExecuteOrder, compact }: HeaterControlProps) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);

  const stateBinding = equipment.dataBindings.find(
    (db) => db.alias === "state" || db.category === "light_state",
  );
  const isOn = stateBinding
    ? stateBinding.value === true || String(stateBinding.value).toUpperCase() === "ON"
    : false;

  // Fil pilote convention: relay ON = éco, relay OFF = confort
  const isComfort = !isOn;

  const toggleBinding = equipment.orderBindings.find(
    (ob) => ob.alias === "state" && (ob.type === "enum" || ob.type === "boolean"),
  );
  const hasToggle = !!toggleBinding;

  const handleToggle = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (executing || !toggleBinding) return;
    setExecuting(true);
    try {
      const onVal = toggleBinding.enumValues?.find((v) => /^on$/i.test(v)) ?? "ON";
      const offVal = toggleBinding.enumValues?.find((v) => /^off$/i.test(v)) ?? "OFF";
      const value = isOn ? offVal : onVal;
      await onExecuteOrder("state", value);
    } finally {
      setExecuting(false);
    }
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {/* State badge */}
        <span
          className={`
            text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0
            ${isComfort
              ? "bg-error/10 text-error"
              : "bg-primary/10 text-primary"
            }
          `}
        >
          {isComfort ? t("controls.heater.comfort") : t("controls.heater.eco")}
        </span>

        {/* Toggle button */}
        {hasToggle && (
          <button
            onClick={handleToggle}
            disabled={executing}
            className={`
              p-1.5 rounded-[6px] transition-colors duration-150 cursor-pointer
              ${isComfort
                ? "bg-error/10 text-error hover:bg-error/20"
                : "bg-primary/10 text-primary hover:bg-primary/20"
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
            title={isComfort ? t("controls.heater.switchEco") : t("controls.heater.switchComfort")}
          >
            {executing
              ? <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
              : isComfort
                ? <Flame size={14} strokeWidth={1.5} />
                : <Snowflake size={14} strokeWidth={1.5} />
            }
          </button>
        )}
      </div>
    );
  }

  // Full view
  return (
    <div className="space-y-4">
      {/* State display */}
      <div className="flex items-center gap-3">
        <div
          className={`
            w-10 h-10 rounded-[8px] flex items-center justify-center
            ${isComfort
              ? "bg-error/10 text-error"
              : "bg-primary/10 text-primary"
            }
          `}
        >
          {isComfort
            ? <Flame size={22} strokeWidth={1.5} />
            : <Snowflake size={22} strokeWidth={1.5} />
          }
        </div>
        <div>
          <div className="text-[16px] font-medium text-text">
            {isComfort ? t("controls.heater.comfort") : t("controls.heater.eco")}
          </div>
          <div className="text-[12px] text-text-tertiary">
            {isOn ? t("controls.heater.relayOn") : t("controls.heater.relayOff")}
          </div>
        </div>
      </div>

      {/* Toggle button */}
      {hasToggle && (
        <button
          onClick={handleToggle}
          disabled={executing}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-[6px] text-[13px] font-medium
            transition-colors duration-150
            ${isComfort
              ? "bg-primary/10 text-primary hover:bg-primary/20"
              : "bg-error/10 text-error hover:bg-error/20"
            }
            disabled:opacity-50
          `}
        >
          {isComfort
            ? <><Snowflake size={16} strokeWidth={1.5} /> {t("controls.heater.switchEco")}</>
            : <><Flame size={16} strokeWidth={1.5} /> {t("controls.heater.switchComfort")}</>
          }
        </button>
      )}
    </div>
  );
}
