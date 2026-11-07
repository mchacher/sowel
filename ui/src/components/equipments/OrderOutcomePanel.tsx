import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ListChecks, Loader2 } from "lucide-react";
import { updateEquipment } from "../../api";
import type { EquipmentWithDetails } from "../../types";
import { ConfigRow } from "./ConfigRow";
import { InfoTooltip } from "../InfoTooltip";
import { isOrderOutcomeTracked } from "../../../../src/shared/order-outcome-tracking";

/**
 * Spec 188 O10 — follow this equipment's orders to their outcome. On by
 * default for a gate and a door, off for a shutter or an awning. Admin-only;
 * the caller mounts it on the types the tracking can follow.
 */
export function OrderOutcomePanel({
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = isOrderOutcomeTracked(equipment);

  const toggle = async (next: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await updateEquipment(equipment.id, { trackOrderOutcome: next });
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConfigRow
      icon={ListChecks}
      title={t("orderOutcome.setting.title")}
      summary={t(enabled ? "equipments.summary.enabled" : "equipments.summary.disabled")}
      defaultOpen={defaultOpen}
    >
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-small text-text cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            disabled={saving}
            onChange={(e) => void toggle(e.target.checked)}
          />
          {t("equipments.gateConfirm.enable")}
        </label>
        <InfoTooltip
          help
          align="start"
          text={t("orderOutcome.setting.hint")}
          label={t("common.help")}
        />
        {saving && <Loader2 size={12} className="animate-spin text-text-tertiary" />}
      </div>
      {error && <p className="text-caption text-error mt-2">{error}</p>}
    </ConfigRow>
  );
}
