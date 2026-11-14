import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Flame, Snowflake, Loader2 } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";
import { findOrderByCategory, relayStateOn } from "./bindingUtils";

interface HeaterControlProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  compact?: boolean;
  /**
   * Compact only: draw the read-only state beside the control (default). The
   * Maison row draws it itself, as a reading that gives way first (#1163).
   */
  withReadings?: boolean;
}

/** Whether the pilot-wire relay is on — which means éco (fil pilote convention). */
function heaterRelayOn(equipment: EquipmentWithDetails): boolean {
  return relayStateOn(equipment.dataBindings);
}

/** The Confort / Éco pill, as the compact rows show it. */
export function HeaterModeBadge({ equipment }: { equipment: EquipmentWithDetails }) {
  const { t } = useTranslation();
  const isComfort = !heaterRelayOn(equipment);
  return (
    <span
      className={`
        text-micro font-medium px-2 py-0.5 rounded-full flex-shrink-0
        ${isComfort ? "bg-heat/10 text-heat" : "bg-primary/10 text-primary"}
      `}
    >
      {isComfort ? t("controls.heater.comfort") : t("controls.heater.eco")}
    </span>
  );
}

export function HeaterControl({
  equipment,
  onExecuteOrder,
  compact,
  withReadings = true,
}: HeaterControlProps) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);

  const isOn = heaterRelayOn(equipment);

  // Fil pilote convention: relay ON = éco, relay OFF = confort
  const isComfort = !isOn;

  // Category-first resolver: heater toggle is `toggle_power` / `light_toggle`
  // depending on the underlying device, with alias fallback for older
  // bindings (spec 110).
  const toggleBinding = findOrderByCategory(
    equipment.orderBindings,
    ["toggle_power", "light_toggle"],
    ["state"],
  );
  const hasToggle =
    !!toggleBinding && (toggleBinding.type === "enum" || toggleBinding.type === "boolean");

  const handleToggle = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (executing || !toggleBinding) return;
    setExecuting(true);
    try {
      const onVal = toggleBinding.enumValues?.find((v) => /^on$/i.test(v)) ?? "ON";
      const offVal = toggleBinding.enumValues?.find((v) => /^off$/i.test(v)) ?? "OFF";
      const value = isOn ? offVal : onVal;
      await onExecuteOrder(toggleBinding.alias, value);
    } finally {
      setExecuting(false);
    }
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {withReadings && <HeaterModeBadge equipment={equipment} />}

        {/* Toggle button */}
        {hasToggle && (
          <button
            onClick={handleToggle}
            disabled={executing}
            className={`
              p-1.5 rounded-sm transition-colors duration-150 cursor-pointer
              ${
                isComfort
                  ? "bg-heat/10 text-heat hover:bg-heat/20"
                  : "bg-primary/10 text-primary hover:bg-primary/20"
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
            title={isComfort ? t("controls.heater.switchEco") : t("controls.heater.switchComfort")}
          >
            {executing ? (
              <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
            ) : isComfort ? (
              <Flame size={14} strokeWidth={1.5} />
            ) : (
              <Snowflake size={14} strokeWidth={1.5} />
            )}
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
            w-10 h-10 rounded-md flex items-center justify-center
            ${isComfort ? "bg-heat/10 text-heat" : "bg-primary/10 text-primary"}
          `}
        >
          {isComfort ? (
            <Flame size={22} strokeWidth={1.5} />
          ) : (
            <Snowflake size={22} strokeWidth={1.5} />
          )}
        </div>
        <div>
          <div className="text-lead font-medium text-text">
            {isComfort ? t("controls.heater.comfort") : t("controls.heater.eco")}
          </div>
          <div className="text-caption text-text-tertiary">
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
            flex items-center gap-2 px-4 py-2 rounded-sm text-small font-medium
            transition-colors duration-150
            ${
              isComfort
                ? "bg-primary/10 text-primary hover:bg-primary/20"
                : "bg-heat/10 text-heat hover:bg-heat/20"
            }
            disabled:opacity-50
          `}
        >
          {isComfort ? (
            <>
              <Snowflake size={16} strokeWidth={1.5} /> {t("controls.heater.switchEco")}
            </>
          ) : (
            <>
              <Flame size={16} strokeWidth={1.5} /> {t("controls.heater.switchComfort")}
            </>
          )}
        </button>
      )}
    </div>
  );
}
