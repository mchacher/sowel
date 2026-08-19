import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown, Loader2 } from "lucide-react";
import { updateEquipment } from "../../api";
import type { EquipmentWithDetails } from "../../types";

/**
 * Spec 154 (issue #614) — per-equipment "invert direction" toggle for a
 * shutter-family motor wired the opposite way. Off by default. When on, the
 * backend flips shutter_move OPEN<->CLOSE and set_shutter_position -> 100-value
 * for this equipment (command-only). Admin-only, shutter-family-only — the
 * caller gates the mount.
 */
export function InvertDirectionPanel({
  equipment,
  onUpdated,
}: {
  equipment: EquipmentWithDetails;
  onUpdated: () => void;
}) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = equipment.invertDirection === true;

  const toggle = async (next: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await updateEquipment(equipment.id, { invertDirection: next });
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
        <ArrowUpDown size={16} strokeWidth={1.5} className="text-text-tertiary" />
        <h3 className="text-[14px] font-semibold text-text">
          {t("equipments.invertDirection.title")}
        </h3>
        <label className="ml-auto flex items-center gap-2 text-[12px] text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            disabled={saving}
            onChange={(e) => void toggle(e.target.checked)}
          />
          {t("equipments.invertDirection.enable")}
        </label>
      </div>
      <p className="text-[12px] text-text-tertiary flex items-center gap-1.5">
        {t("equipments.invertDirection.hint")}
        {saving && <Loader2 size={12} className="animate-spin text-text-tertiary" />}
      </p>
      {error && <p className="text-[12px] text-red-500 mt-2">{error}</p>}
    </div>
  );
}
