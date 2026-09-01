import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitMerge, Loader2 } from "lucide-react";
import { updateEquipment } from "../../api";
import { isSubmeterEquipment } from "../../lib/metering";
import type { EquipmentWithDetails } from "../../types";

/**
 * Spec 173 — declare that this meter's consumption is already counted by
 * another one (a gîte clamp upstream of the water-heater clamp fed from it).
 *
 * The by-usage breakdown then renders the parent net of its children instead of
 * counting the same kilowatt-hours twice. Admin only, and only on equipments
 * that are submeters — the caller gates the mount on the second condition too,
 * this is the belt to that pair of braces.
 *
 * The select offers only meters that cannot make a loop: not this equipment,
 * and none of its descendants. A cycle is refused by the API anyway (400), but
 * an option you can pick and that always fails is a worse UI than no option.
 */
export function MeteringParentPanel({
  equipment,
  equipments,
  onUpdated,
}: {
  equipment: EquipmentWithDetails;
  equipments: EquipmentWithDetails[];
  onUpdated: () => void;
}) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(() => {
    const descendants = new Set<string>([equipment.id]);
    // Walk down: anything whose parent chain reaches this equipment would close
    // a loop. Iterating to a fixed point costs nothing at this size.
    let grew = true;
    while (grew) {
      grew = false;
      for (const eq of equipments) {
        if (eq.meteringParentId && descendants.has(eq.meteringParentId) && !descendants.has(eq.id)) {
          descendants.add(eq.id);
          grew = true;
        }
      }
    }
    return equipments
      .filter(
        (eq) =>
          !descendants.has(eq.id) &&
          // A parent that later lost its power binding stops being offered, but
          // it is still the standing declaration: dropping it would leave the
          // select matching no option and quietly reading "counted nowhere
          // else" while the declaration is live.
          (isSubmeterEquipment(eq) || eq.id === equipment.meteringParentId),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [equipment.id, equipment.meteringParentId, equipments]);

  const current = equipment.meteringParentId ?? "";

  const choose = async (value: string) => {
    setSaving(true);
    setError(null);
    try {
      await updateEquipment(equipment.id, { meteringParentId: value === "" ? null : value });
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
        <GitMerge size={16} strokeWidth={1.5} className="text-text-tertiary" />
        <h3 className="text-[14px] font-semibold text-text">{t("equipments.metering.nesting.title")}</h3>
        <div className="ml-auto flex items-center gap-2">
          {saving && <Loader2 size={12} className="animate-spin text-text-tertiary" />}
          <select
            value={current}
            disabled={saving}
            onChange={(e) => void choose(e.target.value)}
            aria-label={t("equipments.metering.nesting.title")}
            className="px-2 py-1 text-[12px] bg-background border border-border rounded-[6px] text-text max-w-[220px]"
          >
            <option value="">{t("equipments.metering.nesting.none")}</option>
            {candidates.map((eq) => (
              <option key={eq.id} value={eq.id}>
                {eq.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-[12px] text-text-tertiary">{t("equipments.metering.nesting.hint")}</p>
      {error && <p className="text-[12px] text-error mt-2">{error}</p>}
    </div>
  );
}
