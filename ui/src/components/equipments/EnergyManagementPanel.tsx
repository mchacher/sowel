import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PlugZap, Loader2 } from "lucide-react";
import { updateEquipment, resumeArbiterEquipment } from "../../api";
import { useArbiter } from "../../store/useArbiter";
import { defaultEnergyClassFor, defaultEnergyTimingsFor } from "../../lib/energy-profile";
import type { EnergyLoadClass, EquipmentWithDetails } from "../../types";

/**
 * Spec 140 — flexible-load declaration on an equipment (FR-1). Admin only,
 * orderable equipments only. Class and timings are pre-assigned from the
 * equipment type; nominal watts pre-fill from the measured power binding.
 */
export function EnergyManagementPanel({
  equipment,
  onUpdated,
}: {
  equipment: EquipmentWithDetails;
  onUpdated: () => void;
}) {
  const { t } = useTranslation();
  const profile = equipment.energyProfile;
  const arbiterState = useArbiter((s) => s.state);
  const fetchArbiter = useArbiter((s) => s.fetch);

  // Fetch arbiter state on mount so the "Manual until HH:MM" suspension chip
  // and the "resume control now" action (FR-6) actually render — without this
  // the panel only ever sees arbiter state after a resume() round-trip.
  useEffect(() => {
    void fetchArbiter();
  }, [fetchArbiter]);

  const measuredW = useMemo(() => {
    const binding =
      equipment.dataBindings.find((b) => b.category === "power") ??
      equipment.dataBindings.find((b) => b.alias === "power");
    const v = binding?.value;
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  }, [equipment.dataBindings]);

  const defaults = useMemo(() => {
    const timings = defaultEnergyTimingsFor(equipment.type);
    return {
      class: defaultEnergyClassFor(equipment.type),
      nominalPowerW: measuredW ?? profile?.learned?.watts ?? 0,
      ...timings,
    };
  }, [equipment.type, measuredW, profile]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cls, setCls] = useState<EnergyLoadClass | "">(profile?.class ?? defaults.class ?? "");
  const [watts, setWatts] = useState<number>(profile?.nominalPowerW ?? defaults.nominalPowerW);
  const [minOnS, setMinOnS] = useState<number>(profile?.minOnS ?? defaults.minOnS);
  const [minOffS, setMinOffS] = useState<number>(profile?.minOffS ?? defaults.minOffS);

  const suspension = arbiterState?.suspensions.find((s) => s.equipmentId === equipment.id);

  const save = async (next: { enabled: boolean }) => {
    setSaving(true);
    setError(null);
    try {
      if (!next.enabled) {
        await updateEquipment(equipment.id, { energyProfile: null });
      } else {
        if (!cls || !Number.isFinite(watts) || watts <= 0) {
          setError(t("energyProfile.invalid"));
          setSaving(false);
          return;
        }
        await updateEquipment(equipment.id, {
          energyProfile: { class: cls, nominalPowerW: watts, minOnS, minOffS },
        });
      }
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const resume = async () => {
    try {
      await resumeArbiterEquipment(equipment.id);
      await fetchArbiter();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const inputCls =
    "w-24 px-2 py-1 border border-border rounded text-[13px] text-text bg-background";

  return (
    <div className="bg-surface rounded-[10px] border border-border mb-6 p-4">
      <div className="flex items-center gap-2 mb-1">
        <PlugZap size={16} strokeWidth={1.5} className="text-text-tertiary" />
        <h3 className="text-[14px] font-semibold text-text">{t("energyProfile.title")}</h3>
        <label className="ml-auto flex items-center gap-2 text-[12px] text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={!!profile}
            disabled={saving}
            onChange={(e) => void save({ enabled: e.target.checked })}
          />
          {t("energyProfile.enable")}
        </label>
      </div>
      <p className="text-[12px] text-text-tertiary mb-3">{t("energyProfile.hint")}</p>

      {suspension && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md bg-accent/10 border border-accent/20 text-[12px] text-text-secondary">
          <span>
            {t("energyProfile.manualUntil", {
              time: new Date(suspension.untilIso).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
            })}
          </span>
          <button
            onClick={() => void resume()}
            className="ml-auto text-[12px] font-medium text-primary hover:text-primary-hover"
          >
            {t("energyProfile.resumeNow")}
          </button>
        </div>
      )}

      {profile && (
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">
              {t("energyProfile.class")}
            </label>
            <select
              value={cls}
              onChange={(e) => setCls(e.target.value as EnergyLoadClass)}
              onBlur={() => void save({ enabled: true })}
              className="px-2 py-1 border border-border rounded text-[13px] text-text bg-background"
            >
              <option value="deferrable">{t("energyProfile.deferrable")}</option>
              <option value="comfort">{t("energyProfile.comfort")}</option>
            </select>
          </div>
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">
              {t("energyProfile.nominalW")}
            </label>
            <input
              type="number"
              min={1}
              value={watts || ""}
              onChange={(e) => setWatts(Number(e.target.value))}
              onBlur={() => void save({ enabled: true })}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">
              {t("energyProfile.minOn")}
            </label>
            <input
              type="number"
              min={0}
              value={minOnS}
              onChange={(e) => setMinOnS(Number(e.target.value))}
              onBlur={() => void save({ enabled: true })}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[12px] text-text-secondary mb-1">
              {t("energyProfile.minOff")}
            </label>
            <input
              type="number"
              min={0}
              value={minOffS}
              onChange={(e) => setMinOffS(Number(e.target.value))}
              onBlur={() => void save({ enabled: true })}
              className={inputCls}
            />
          </div>
          {profile.learned && (
            <div className="text-[12px] text-text-tertiary pb-1">
              {t("energyProfile.learned", {
                watts: profile.learned.watts,
                runs: profile.learned.runs,
              })}
            </div>
          )}
          {saving && <Loader2 size={14} className="animate-spin text-text-tertiary mb-2" />}
        </div>
      )}

      {error && <p className="text-[12px] text-red-500 mt-2">{error}</p>}
    </div>
  );
}
