import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, WashingMachine } from "lucide-react";
import { updateEquipment } from "../../api";
import type { ApplianceCycleThresholds, EquipmentWithDetails } from "../../types";
import { ConfigRow } from "./ConfigRow";
import { InfoTooltip } from "../InfoTooltip";
import { formatDuration, formatPower } from "../../lib/format";

/** Same values as the core's APPLIANCE_CYCLE_DEFAULTS (spec 213). */
const DEFAULTS: ApplianceCycleThresholds = { startW: 15, endW: 10, endDelayS: 300 };

/**
 * Spec 213 (FR3) — when an appliance read on its power is running and when its
 * cycle is over. Admin only, appliance only — the caller gates the mount. While
 * a device reports the state, the derived one is inactive: the row says so and
 * stays editable, so the thresholds are ready for the day the binding goes.
 */
export function ApplianceCyclePanel({
  equipment,
  onUpdated,
  defaultOpen = false,
}: {
  equipment: EquipmentWithDetails;
  onUpdated: () => void;
  /** Open on arrival; the equipment page keeps its Configuration rows closed. */
  defaultOpen?: boolean;
}) {
  const { t } = useTranslation();
  const configured = equipment.applianceCycle ?? null;
  const current = configured ?? DEFAULTS;
  const [startW, setStartW] = useState(String(current.startW));
  const [endW, setEndW] = useState(String(current.endW));
  const [endDelayMin, setEndDelayMin] = useState(String(current.endDelayS / 60));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStartW(String(current.startW));
    setEndW(String(current.endW));
    setEndDelayMin(String(current.endDelayS / 60));
  }, [current.startW, current.endW, current.endDelayS]);

  const reportedState = equipment.dataBindings.some(
    (b) => b.alias === "state" && !b.id.startsWith("virtual:"),
  );
  const measuredPower = equipment.dataBindings.some(
    (b) => b.alias === "power" && b.type === "number",
  );

  const save = async (next: ApplianceCycleThresholds | null) => {
    setSaving(true);
    setError(null);
    try {
      await updateEquipment(equipment.id, { applianceCycle: next });
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const commit = () => {
    const next = {
      startW: Number(startW),
      endW: Number(endW),
      endDelayS: Math.round(Number(endDelayMin) * 60),
    };
    if (
      next.startW === current.startW &&
      next.endW === current.endW &&
      next.endDelayS === current.endDelayS
    ) {
      return;
    }
    void save(next);
  };

  const summary = reportedState
    ? t("equipments.applianceCycle.inactiveSummary")
    : t("equipments.applianceCycle.summary", {
        start: formatPower(current.startW),
        end: formatPower(current.endW),
        delay: formatDuration(current.endDelayS),
      });

  const inputCls =
    "w-20 px-2 py-1 border border-border rounded-sm text-small text-text bg-background tabular-nums";

  return (
    <ConfigRow
      icon={WashingMachine}
      title={t("equipments.applianceCycle.title")}
      summary={summary}
      defaultOpen={defaultOpen}
    >
      {reportedState && (
        <p className="text-caption text-text-secondary mb-3">
          {t("equipments.applianceCycle.inactive")}
        </p>
      )}
      {!reportedState && !measuredPower && (
        <p className="text-caption text-text-secondary mb-3">
          {t("equipments.applianceCycle.noPower")}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="ac-start" className="block text-caption text-text-secondary mb-1">
            {t("equipments.applianceCycle.startW")}
          </label>
          <span className="flex items-center gap-1">
            <input
              id="ac-start"
              type="number"
              min={1}
              max={5000}
              value={startW}
              disabled={saving}
              onChange={(e) => setStartW(e.target.value)}
              onBlur={commit}
              className={inputCls}
            />
            <span className="text-caption text-text-tertiary">W</span>
          </span>
        </div>
        <div>
          <label htmlFor="ac-end" className="block text-caption text-text-secondary mb-1">
            {t("equipments.applianceCycle.endW")}
          </label>
          <span className="flex items-center gap-1">
            <input
              id="ac-end"
              type="number"
              min={1}
              value={endW}
              disabled={saving}
              onChange={(e) => setEndW(e.target.value)}
              onBlur={commit}
              className={inputCls}
            />
            <span className="text-caption text-text-tertiary">W</span>
          </span>
        </div>
        <div>
          <label htmlFor="ac-delay" className="block text-caption text-text-secondary mb-1">
            {t("equipments.applianceCycle.endDelay")}
          </label>
          <span className="flex items-center gap-1">
            <input
              id="ac-delay"
              type="number"
              min={0.5}
              max={60}
              step={0.5}
              value={endDelayMin}
              disabled={saving}
              onChange={(e) => setEndDelayMin(e.target.value)}
              onBlur={commit}
              className={inputCls}
            />
            <span className="text-caption text-text-tertiary">min</span>
          </span>
        </div>
        <InfoTooltip
          help
          align="start"
          text={t("equipments.applianceCycle.hint")}
          label={t("common.help")}
        />
        {saving && <Loader2 size={12} className="animate-spin text-text-tertiary" />}
      </div>
      {configured && (
        <button
          type="button"
          disabled={saving}
          onClick={() => void save(null)}
          className="mt-3 text-caption text-primary hover:underline cursor-pointer"
        >
          {t("equipments.applianceCycle.reset")}
        </button>
      )}
      {error && <p className="text-caption text-error mt-2">{error}</p>}
    </ConfigRow>
  );
}
