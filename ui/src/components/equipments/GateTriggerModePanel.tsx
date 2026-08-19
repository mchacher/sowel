import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Loader2 } from "lucide-react";
import { updateEquipment } from "../../api";
import type { EquipmentWithDetails } from "../../types";

/**
 * Issue #627 — per-equipment "toggle trigger" mode for a momentary boolean
 * gate command. Off by default ("fixed" — always sends the same value). When
 * on, the backend sends the logical inverse of the device's last known state
 * instead, for relays that never report their own auto-off (reported state
 * gets stuck, so resending the same fixed value twice in a row is silently
 * dropped). Admin-only, gate-only — the caller gates the mount.
 */
export function GateTriggerModePanel({
  equipment,
  onUpdated,
}: {
  equipment: EquipmentWithDetails;
  onUpdated: () => void;
}) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = equipment.gateTriggerMode === "toggle";

  const toggle = async (next: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await updateEquipment(equipment.id, { gateTriggerMode: next ? "toggle" : "fixed" });
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
        <RefreshCw size={16} strokeWidth={1.5} className="text-text-tertiary" />
        <h3 className="text-[14px] font-semibold text-text">
          {t("equipments.gateTriggerMode.title")}
        </h3>
        <label className="ml-auto flex items-center gap-2 text-[12px] text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            disabled={saving}
            onChange={(e) => void toggle(e.target.checked)}
          />
          {t("equipments.gateTriggerMode.enable")}
        </label>
      </div>
      <p className="text-[12px] text-text-tertiary flex items-center gap-1.5">
        {t("equipments.gateTriggerMode.hint")}
        {saving && <Loader2 size={12} className="animate-spin text-text-tertiary" />}
      </p>
      {error && <p className="text-[12px] text-red-500 mt-2">{error}</p>}
    </div>
  );
}
