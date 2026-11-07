import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown, Loader2 } from "lucide-react";
import { updateEquipment } from "../../api";
import type { EquipmentWithDetails } from "../../types";
import { ConfigRow } from "./ConfigRow";
import { InfoTooltip } from "../InfoTooltip";

/**
 * Spec 154 (issue #614) — per-equipment "invert direction" toggle for a
 * shutter-family motor wired the opposite way. Off by default. When on, the
 * backend flips shutter_move OPEN<->CLOSE and set_shutter_position -> 100-value
 * for this equipment (command-only). Admin-only, shutter-family-only — the
 * caller gates the mount.
 *
 * Extended (issue #627) to `gate` equipments with a boolean momentary
 * trigger: when on, an empty trigger resolves to `false` instead of `true` —
 * for a relay wired to pulse on the opposite edge. Same field, same backend
 * flag, just different copy for a gate vs a shutter/pool_cover.
 */
export function InvertDirectionPanel({
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
  const enabled = equipment.invertDirection === true;
  const copyPrefix =
    equipment.type === "gate" ? "equipments.invertDirectionGate" : "equipments.invertDirection";

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
    <ConfigRow
      icon={ArrowUpDown}
      title={t(`${copyPrefix}.title`)}
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
          {t(`${copyPrefix}.enable`)}
        </label>
        <InfoTooltip help align="start" text={t(`${copyPrefix}.hint`)} label={t("common.help")} />
        {saving && <Loader2 size={12} className="animate-spin text-text-tertiary" />}
      </div>
      {error && <p className="text-caption text-error mt-2">{error}</p>}
    </ConfigRow>
  );
}
