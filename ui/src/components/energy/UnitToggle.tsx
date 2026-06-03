import { useTranslation } from "react-i18next";
import { useUiState, type EnergyUnit } from "../../store/useUiState";

interface UnitToggleProps {
  /** When false, the toggle is disabled and shows a tooltip pointing to settings. */
  enabled: boolean;
}

// Spec 123 — segmented Wh / € control. Mirrors the look of the
// viewMode (Total / By usage) toggle next to it so the page header
// stays visually consistent.
export function UnitToggle({ enabled }: UnitToggleProps) {
  const { t } = useTranslation();
  const unit = useUiState((s) => s.energyUnit);
  const setUnit = useUiState((s) => s.setEnergyUnit);

  const effectiveUnit: EnergyUnit = enabled ? unit : "wh";
  const tooltip = enabled ? undefined : t("energy.unit.tariffMissing");

  return (
    <div
      className={
        "inline-flex border border-border rounded-[6px] overflow-hidden text-[12px]" +
        (enabled ? "" : " opacity-50 cursor-not-allowed")
      }
      title={tooltip}
    >
      <button
        type="button"
        disabled={!enabled}
        onClick={() => enabled && setUnit("wh")}
        className={
          effectiveUnit === "wh"
            ? "px-3 py-1 bg-primary text-white"
            : "px-3 py-1 text-text-secondary hover:bg-bg disabled:hover:bg-transparent"
        }
      >
        {t("energy.unit.wh")}
      </button>
      <button
        type="button"
        disabled={!enabled}
        onClick={() => enabled && setUnit("eur")}
        className={
          effectiveUnit === "eur"
            ? "px-3 py-1 bg-primary text-white"
            : "px-3 py-1 text-text-secondary hover:bg-bg disabled:hover:bg-transparent"
        }
      >
        {t("energy.unit.eur")}
      </button>
    </div>
  );
}
