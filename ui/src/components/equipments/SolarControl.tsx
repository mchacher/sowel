import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sun } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";
import { findOrderByCategory, findDataByCategory } from "./bindingUtils";

interface SolarControlProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  compact?: boolean;
}

/**
 * Spec 152 — the dedicated "solar" on/off control. It is the exact same toggle
 * as the light/switch on/off (LightControl), only the glyph changes to a sun.
 * It drives the `solar` command channel (category `solar_toggle`) and reflects
 * the `solar_state` feedback, both fully independent from the main on/off.
 *
 * Renders nothing when the equipment has no solar command bound.
 */
export function SolarControl({ equipment, onExecuteOrder, compact }: SolarControlProps) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);

  const toggleBinding = findOrderByCategory(equipment.orderBindings, ["solar_toggle"], ["solar"]);
  if (!toggleBinding) return null;

  const stateBinding = findDataByCategory(equipment.dataBindings, ["solar_state"], ["solar_state"]);
  const isOn = stateBinding
    ? stateBinding.value === true || String(stateBinding.value).toUpperCase() === "ON"
    : false;

  const handleToggle = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (executing) return;
    setExecuting(true);
    try {
      const alias = toggleBinding.alias;
      const onVal = toggleBinding.enumValues?.find((v) => /^on$/i.test(v)) ?? "ON";
      const offVal = toggleBinding.enumValues?.find((v) => /^off$/i.test(v)) ?? "OFF";
      const value =
        toggleBinding.type === "boolean" && alias !== "state" ? !isOn : isOn ? offVal : onVal;
      await onExecuteOrder(alias, value);
    } finally {
      setExecuting(false);
    }
  };

  const title = `${t("controls.solar")} · ${isOn ? t("controls.turnOff") : t("controls.turnOn")}`;

  if (compact) {
    return (
      <button
        onClick={handleToggle}
        disabled={executing}
        className={`
          p-2 rounded-[6px] transition-colors duration-150 cursor-pointer
          ${
            isOn
              ? "bg-accent text-white hover:bg-accent-hover"
              : "bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary"
          }
          disabled:opacity-50 disabled:cursor-not-allowed
        `}
        title={title}
        onClickCapture={(e) => e.stopPropagation()}
      >
        <Sun size={16} strokeWidth={1.5} />
      </button>
    );
  }

  return (
    <button
      onClick={handleToggle}
      disabled={executing}
      className={`
        flex items-center gap-2 px-4 py-2 rounded-[6px] text-[13px] font-medium
        transition-colors duration-150
        ${
          isOn
            ? "bg-accent text-white hover:bg-accent-hover"
            : "bg-border-light text-text-secondary hover:bg-border hover:text-text"
        }
        disabled:opacity-50
      `}
    >
      <Sun size={16} strokeWidth={1.5} />
      {t("controls.solar")}
      {" · "}
      {executing ? "..." : isOn ? t("common.on") : t("common.off")}
    </button>
  );
}
