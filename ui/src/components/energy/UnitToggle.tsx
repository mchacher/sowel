import { useTranslation } from "react-i18next";
import { useUiState, type EnergyUnit } from "../../store/useUiState";
import { SegmentedControl } from "../ui/SegmentedControl";

interface UnitToggleProps {
  /** When false, the toggle is disabled and shows a tooltip pointing to settings. */
  enabled: boolean;
  /** Layout classes from the caller. */
  className?: string;
}

// Spec 123 — the Wh / € switch of the Consumption page. Drawn by the shared
// SegmentedControl since spec 197, like the Total / By usage switch and the
// period tabs next to it.
export function UnitToggle({ enabled, className }: UnitToggleProps) {
  const { t } = useTranslation();
  const unit = useUiState((s) => s.energyUnit);
  const setUnit = useUiState((s) => s.setEnergyUnit);

  const effectiveUnit: EnergyUnit = enabled ? unit : "wh";

  return (
    <SegmentedControl<EnergyUnit>
      options={[
        { value: "wh", label: t("energy.unit.wh") },
        { value: "eur", label: t("energy.unit.eur") },
      ]}
      value={effectiveUnit}
      onChange={setUnit}
      label={t("energy.unit.label")}
      disabled={!enabled}
      title={enabled ? undefined : t("energy.unit.tariffMissing")}
      className={className}
    />
  );
}
