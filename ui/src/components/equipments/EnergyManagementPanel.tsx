import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PlugZap, Loader2 } from "lucide-react";
import { updateEquipment, resumeArbiterEquipment } from "../../api";
import { useArbiter } from "../../store/useArbiter";
import {
  defaultEnergyClassFor,
  defaultEnergyTimingsFor,
  minutesToSeconds,
  secondsToMinutes,
} from "../../lib/energy-profile";
import type { EnergyLoadClass, EnergyLoadProfile, EquipmentWithDetails } from "../../types";

/**
 * Spec 140 — flexible-load declaration on an equipment (FR-1). Admin only,
 * orderable equipments only.
 *
 * Ticking "flexible load" REVEALS the form (pre-filled). The first save is an
 * explicit Save button — not an on-blur side effect — because a native select
 * does not blur when you pick an option, so "pick the class last, navigate
 * away" would otherwise lose a completed profile. Once a profile exists,
 * edits persist live on change/blur. Removing an existing profile asks first
 * (it discards the learned power estimate).
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

  const [open, setOpen] = useState<boolean>(!!profile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cls, setCls] = useState<EnergyLoadClass | "">(profile?.class ?? defaults.class ?? "");
  const [watts, setWatts] = useState<number>(profile?.nominalPowerW ?? defaults.nominalPowerW);
  const [toleratedImportW, setToleratedImportW] = useState<number>(profile?.toleratedImportW ?? 0);
  const [minOnS, setMinOnS] = useState<number>(profile?.minOnS ?? defaults.minOnS);
  const [minOffS, setMinOffS] = useState<number>(profile?.minOffS ?? defaults.minOffS);

  const suspension = arbiterState?.suspensions.find((s) => s.equipmentId === equipment.id);
  const complete = cls !== "" && Number.isFinite(watts) && watts > 0;

  // Persist an explicit profile (values passed in so a select's onChange can
  // save the value it just set, without waiting for React state).
  const commit = async (p: {
    cls: EnergyLoadClass | "";
    watts: number;
    toleratedImportW: number;
    minOnS: number;
    minOffS: number;
  }) => {
    if (p.cls === "" || !Number.isFinite(p.watts) || p.watts <= 0) return;
    setSaving(true);
    setError(null);
    try {
      const next: EnergyLoadProfile = {
        class: p.cls,
        nominalPowerW: p.watts,
        toleratedImportW: Number.isFinite(p.toleratedImportW) ? Math.max(0, p.toleratedImportW) : 0,
        minOnS: p.minOnS,
        minOffS: p.minOffS,
      };
      await updateEquipment(equipment.id, { energyProfile: next });
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  /** Live-save an edit, but only once a profile already exists. */
  const commitEdit = (
    overrides: Partial<{
      cls: EnergyLoadClass | "";
      watts: number;
      toleratedImportW: number;
      minOnS: number;
      minOffS: number;
    }>,
  ) => {
    if (!profile) return;
    void commit({ cls, watts, toleratedImportW, minOnS, minOffS, ...overrides });
  };

  const clear = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateEquipment(equipment.id, { energyProfile: null });
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const toggle = (checked: boolean) => {
    setError(null);
    if (checked) {
      setOpen(true); // reveal the form; the explicit Save persists it
      return;
    }
    if (profile) {
      // Turning it off removes a saved profile (and its learned estimate) —
      // confirm so a stray click cannot wipe it.
      if (!window.confirm(t("energyProfile.removeConfirm"))) return;
      setOpen(false);
      void clear();
    } else {
      setOpen(false); // nothing saved yet, just collapse
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
            checked={open}
            disabled={saving}
            onChange={(e) => toggle(e.target.checked)}
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
            className="ml-auto text-[12px] font-medium text-primary hover:text-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
          >
            {t("energyProfile.resumeNow")}
          </button>
        </div>
      )}

      {open && (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="ep-class" className="block text-[12px] text-text-secondary mb-1">
                {t("energyProfile.class")}
              </label>
              <select
                id="ep-class"
                value={cls}
                onChange={(e) => {
                  const c = e.target.value as EnergyLoadClass;
                  setCls(c);
                  commitEdit({ cls: c });
                }}
                className="px-2 py-1 border border-border rounded text-[13px] text-text bg-background"
              >
                <option value="" disabled>
                  {t("energyProfile.chooseClass")}
                </option>
                <option value="deferrable">{t("energyProfile.deferrable")}</option>
                <option value="comfort">{t("energyProfile.comfort")}</option>
              </select>
            </div>
            <div>
              <label htmlFor="ep-watts" className="block text-[12px] text-text-secondary mb-1">
                {t("energyProfile.nominalW")}
              </label>
              <input
                id="ep-watts"
                type="number"
                min={1}
                value={watts || ""}
                onChange={(e) => setWatts(Number(e.target.value))}
                onBlur={() => commitEdit({ watts })}
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="ep-tolimport" className="block text-[12px] text-text-secondary mb-1">
                {t("energyProfile.toleratedImport")}
              </label>
              <input
                id="ep-tolimport"
                type="number"
                min={0}
                value={toleratedImportW || ""}
                onChange={(e) => setToleratedImportW(Number(e.target.value))}
                onBlur={() => commitEdit({ toleratedImportW })}
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="ep-minon" className="block text-[12px] text-text-secondary mb-1">
                {t("energyProfile.minOn")}
              </label>
              <input
                id="ep-minon"
                type="number"
                min={0}
                step={0.1}
                value={secondsToMinutes(minOnS)}
                onChange={(e) => setMinOnS(minutesToSeconds(Number(e.target.value)))}
                onBlur={() => commitEdit({ minOnS })}
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="ep-minoff" className="block text-[12px] text-text-secondary mb-1">
                {t("energyProfile.minOff")}
              </label>
              <input
                id="ep-minoff"
                type="number"
                min={0}
                step={0.1}
                value={secondsToMinutes(minOffS)}
                onChange={(e) => setMinOffS(minutesToSeconds(Number(e.target.value)))}
                onBlur={() => commitEdit({ minOffS })}
                className={inputCls}
              />
            </div>
            {profile?.learned && (
              <div className="text-[12px] text-text-tertiary pb-1">
                {t("energyProfile.learned", {
                  watts: profile.learned.watts,
                  runs: profile.learned.runs,
                })}
              </div>
            )}
            {saving && <Loader2 size={14} className="animate-spin text-text-tertiary mb-2" />}
          </div>

          {/* Definition of the two classes, right where the choice is made. */}
          <p className="text-[12px] text-text-tertiary mt-2">{t("energyProfile.classHelp")}</p>

          {!profile &&
            (complete ? (
              <button
                onClick={() => void commit({ cls, watts, toleratedImportW, minOnS, minOffS })}
                disabled={saving}
                className="mt-3 px-3 py-1.5 bg-primary text-white text-[13px] font-medium rounded-md hover:bg-primary-hover disabled:opacity-50"
              >
                {t("energyProfile.save")}
              </button>
            ) : (
              <p className="text-[12px] text-text-tertiary mt-2">{t("energyProfile.completeToEnable")}</p>
            ))}
        </>
      )}

      {error && <p className="text-[12px] text-red-500 mt-2">{error}</p>}
    </div>
  );

  async function resume() {
    try {
      await resumeArbiterEquipment(equipment.id);
      await fetchArbiter();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
}
