import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, Loader2 } from "lucide-react";
import { updateEquipment } from "../../api";
import type { EquipmentWithDetails } from "../../types";
import { ConfigRow } from "./ConfigRow";
import { InfoTooltip } from "../InfoTooltip";

/**
 * Spec 146 — opt-in "confirmation before action" toggle for a gate equipment.
 * Off by default. When on, every UI path that actuates the gate in one press
 * asks first — a slide on touch, a dialog with a pointer (spec 196, which
 * extended spec 146's mobile dashboard to every surface). Protects against an
 * accidental one-tap, issue #320.
 * Admin-only, gate-only — the caller gates the mount.
 */
export function GateConfirmationPanel({
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
    <ConfigRow
      icon={ShieldCheck}
      title={t("equipments.gateConfirm.title")}
      summary={t(enabled ? "equipments.summary.enabledF" : "equipments.summary.disabledF")}
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
        <InfoTooltip help align="start" text={t("equipments.gateConfirm.hint")} label={t("common.help")} />
        {saving && <Loader2 size={12} className="animate-spin text-text-tertiary" />}
      </div>
      {error && <p className="text-caption text-error mt-2">{error}</p>}
    </ConfigRow>
  );
}
