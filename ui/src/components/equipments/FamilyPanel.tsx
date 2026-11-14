import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Palette } from "lucide-react";
import { updateEquipment } from "../../api";
import type { EquipmentFamily, EquipmentWithDetails } from "../../types";
import { EQUIPMENT_FAMILIES, familyOf } from "../../lib/equipment-family";
import { ConfigRow } from "./ConfigRow";
import { InfoTooltip } from "../InfoTooltip";

/**
 * Spec 208 (FR5) — the family of a plug or relay. The same switch drives a
 * radiator in one room and a router in another: the installation says which
 * family it belongs to, and the Maison view shows it in that family's section,
 * in its colours. « None » keeps it with the plugs. Admin-only, switch-only —
 * the caller gates the mount.
 */
export function FamilyPanel({
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
  const current = familyOf(equipment);

  const save = async (next: EquipmentFamily | null) => {
    setSaving(true);
    setError(null);
    try {
      await updateEquipment(equipment.id, { family: next });
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConfigRow
      icon={Palette}
      title={t("equipments.familySetting.title")}
      summary={current ? t(`equipments.family.${current}`) : t("equipments.familySetting.none")}
      defaultOpen={defaultOpen}
    >
      <div className="flex items-center gap-2">
        <select
          aria-label={t("equipments.familySetting.title")}
          value={current ?? ""}
          disabled={saving}
          onChange={(e) => void save((e.target.value || null) as EquipmentFamily | null)}
          className="px-3 py-1.5 text-small border border-border bg-surface rounded-sm text-text"
        >
          <option value="">{t("equipments.familySetting.none")}</option>
          {EQUIPMENT_FAMILIES.map((f) => (
            <option key={f} value={f}>
              {t(`equipments.family.${f}`)}
            </option>
          ))}
        </select>
        <InfoTooltip
          help
          align="start"
          text={t("equipments.familySetting.hint")}
          label={t("common.help")}
        />
        {saving && <Loader2 size={12} className="animate-spin text-text-tertiary" />}
      </div>
      {error && <p className="text-caption text-error mt-2">{error}</p>}
    </ConfigRow>
  );
}
