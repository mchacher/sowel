import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, Loader2 } from "lucide-react";
import { updateEquipment } from "../../api";
import type { EquipmentWithDetails } from "../../types";

/**
 * Spec 146 — opt-in "confirmation before action" toggle for a gate equipment.
 * Off by default. When on, the mobile dashboard requires a slide-to-confirm
 * before actuating (protects against an accidental one-tap, issue #320).
 * Admin-only, gate-only — the caller gates the mount.
 */
export function GateConfirmationPanel({
  equipment,
  onUpdated,
}: {
  equipment: EquipmentWithDetails;
  onUpdated: () => void;
}) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = equipment.requireConfirmation === true;

  const toggle = async (next: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await updateEquipment(equipment.id, { requireConfirmation: next });
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
        <ShieldCheck size={16} strokeWidth={1.5} className="text-text-tertiary" />
        <h3 className="text-[14px] font-semibold text-text">{t("equipments.gateConfirm.title")}</h3>
        <label className="ml-auto flex items-center gap-2 text-[12px] text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            disabled={saving}
            onChange={(e) => void toggle(e.target.checked)}
          />
          {t("equipments.gateConfirm.enable")}
        </label>
      </div>
      <p className="text-[12px] text-text-tertiary flex items-center gap-1.5">
        {t("equipments.gateConfirm.hint")}
        {saving && <Loader2 size={12} className="animate-spin text-text-tertiary" />}
      </p>
      {error && <p className="text-[12px] text-red-500 mt-2">{error}</p>}
    </div>
  );
}
