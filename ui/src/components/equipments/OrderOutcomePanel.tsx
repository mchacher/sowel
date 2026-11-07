import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ListChecks, Loader2 } from "lucide-react";
import { updateEquipment } from "../../api";
import type { EquipmentWithDetails } from "../../types";
import { isOrderOutcomeTracked } from "../../../../src/shared/order-outcome-tracking";

/**
 * Spec 188 O10 — follow this equipment's orders to their outcome. On by
 * default for a gate and a door, off for a shutter or an awning. Admin-only;
 * the caller mounts it on the types the tracking can follow.
 */
export function OrderOutcomePanel({
  equipment,
  onUpdated,
}: {
  equipment: EquipmentWithDetails;
  onUpdated: () => void;
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
    <div className="bg-surface rounded-[10px] border border-border mb-6 p-4">
      <div className="flex items-center gap-2 mb-1">
        <ListChecks size={16} strokeWidth={1.5} className="text-text-tertiary" />
        <h3 className="text-body font-semibold text-text">{t("orderOutcome.setting.title")}</h3>
        <label className="ml-auto flex items-center gap-2 text-caption text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            disabled={saving}
            onChange={(e) => void toggle(e.target.checked)}
          />
          {t("equipments.gateConfirm.enable")}
        </label>
      </div>
      <p className="text-caption text-text-tertiary flex items-center gap-1.5">
        {t("orderOutcome.setting.hint")}
        {saving && <Loader2 size={12} className="animate-spin text-text-tertiary" />}
      </p>
      {error && <p className="text-caption text-red-500 mt-2">{error}</p>}
    </div>
  );
}
