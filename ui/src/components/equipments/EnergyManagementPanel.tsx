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
import { ConfigRow } from "./ConfigRow";
import { InfoTooltip } from "../InfoTooltip";
import { currentLocale, formatPower } from "../../lib/format";

/**
 * Spec 140 — flexible-load declaration on an equipment (FR-1). Admin only,
 * orderable equipments only.
 *
 * Ticking "flexible load" REVEALS the form (pre-filled). The first save is an
 * explicit Save button, not an on-blur side effect, so a completed profile is
 * never lost by navigating away before any field blurs. Once a profile exists,
 * edits persist live on change/blur. Removing an existing profile asks first
 * (it discards the learned power estimate).
 *
 * Issue #555 — the load class is derived from the equipment type, not picked
 * by the user (a water heater is always a relay, a thermostat always
 * self-regulating). Types with no energy semantics cannot be declared flexible.
 */
export function EnergyManagementPanel({
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
  const profile = equipment.energyProfile;
  const arbiterState = useArbiter((s) => s.state);
  const fetchArbiter = useArbiter((s) => s.fetch);

  useEffect(() => {
    void fetchArbiter();
  }, [fetchArbiter]);

  const measuredW = useMemo(() => {
    // Numeric guard: a thermostat's boolean run state must never shadow the
    // clamp reading (spec 176), same rule as pickLivePowerBinding.
    const binding =
      equipment.dataBindings.find(
        (b) => b.category === "power" && typeof b.value === "number",
      ) ?? equipment.dataBindings.find((b) => b.alias === "power" && typeof b.value === "number");
    const v = binding?.value;
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  }, [equipment.dataBindings]);

  const defaults = useMemo(() => {
    const timings = defaultEnergyTimingsFor(equipment.type);
    return {
      nominalPowerW: measuredW ?? profile?.learned?.watts ?? 0,
      ...timings,
    };
  }, [equipment.type, measuredW, profile]);

  // Issue #555 — the load class (comfort/deferrable) is a physical property of
  // the equipment type, not a user preference, so it is derived rather than
  // picked. For a known type the derived class wins (this normalises any legacy
  // override saved back when the class was a dropdown, on the next save). It
  // falls back to the stored class only for types with no derived class, so an
  // existing profile is never orphaned. `derivedClass` is null for types with
  // no energy semantics; such an equipment cannot be declared a flexible load
  // unless one already exists.
  const derivedClass = defaultEnergyClassFor(equipment.type);
  const cls: EnergyLoadClass | "" = derivedClass ?? profile?.class ?? "";
  const canEnable = derivedClass !== null || !!profile;

  const [open, setOpen] = useState<boolean>(!!profile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watts, setWatts] = useState<number>(profile?.nominalPowerW ?? defaults.nominalPowerW);
  const [toleratedImportW, setToleratedImportW] = useState<number>(profile?.toleratedImportW ?? 0);
  const [minOnS, setMinOnS] = useState<number>(profile?.minOnS ?? defaults.minOnS);
  const [minOffS, setMinOffS] = useState<number>(profile?.minOffS ?? defaults.minOffS);
  const [releaseDelayS, setReleaseDelayS] = useState<number>(profile?.releaseDelayS ?? 0);

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
    releaseDelayS: number;
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
      // #631 — persisted only when set; absent = the global releaseHoldS grace.
      if (Number.isFinite(p.releaseDelayS) && p.releaseDelayS > 0) {
        next.releaseDelayS = Math.max(0, Math.round(p.releaseDelayS));
      }
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
      watts: number;
      toleratedImportW: number;
      minOnS: number;
      minOffS: number;
      releaseDelayS: number;
    }>,
  ) => {
    if (!profile) return;
    void commit({ cls, watts, toleratedImportW, minOnS, minOffS, releaseDelayS, ...overrides });
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
    "w-24 px-2 py-1 border border-border rounded-sm text-small text-text bg-background";

  // Spec 196 — a type with no energy semantics (a shutter, a gate) cannot be
  // declared a flexible load: the panel said so behind a greyed-out box, on
  // every such page. It now stays away. An existing profile keeps it (canEnable).
  if (!canEnable) return null;

  const summary = profile
    ? `${t("energyProfile.enable")} · ${formatPower(profile.nominalPowerW)}`
    : t("equipments.summary.disabled");

  return (
    <ConfigRow icon={PlugZap} title={t("energyProfile.title")} summary={summary} defaultOpen={defaultOpen}>
      <div className="flex items-center gap-2 mb-3">
        <label className="flex items-center gap-2 text-small text-text cursor-pointer">
          <input
            type="checkbox"
            checked={open}
            disabled={saving}
            onChange={(e) => toggle(e.target.checked)}
          />
          {t("energyProfile.enable")}
        </label>
        <InfoTooltip help align="start" text={t("energyProfile.hint")} label={t("common.help")} />
      </div>

      {suspension && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md bg-primary-light border border-primary/20 text-caption text-text-secondary">
          <span>
            {t("energyProfile.manualUntil", {
              time: new Date(suspension.untilIso).toLocaleTimeString(currentLocale(), {
                hour: "2-digit",
                minute: "2-digit",
              }),
            })}
          </span>
          <button
            onClick={() => void resume()}
            className="ml-auto text-caption font-medium text-primary hover:text-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded-sm"
          >
            {t("energyProfile.resumeNow")}
          </button>
        </div>
      )}

      {open && (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="ep-watts" className="block text-caption text-text-secondary mb-1">
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
              <label htmlFor="ep-tolimport" className="block text-caption text-text-secondary mb-1">
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
              <label htmlFor="ep-minon" className="block text-caption text-text-secondary mb-1">
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
              <label htmlFor="ep-minoff" className="block text-caption text-text-secondary mb-1">
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
            <div>
              <label
                htmlFor="ep-releasedelay"
                className="block text-caption text-text-secondary mb-1"
                title={t("energyProfile.releaseDelayHint")}
              >
                {t("energyProfile.releaseDelay")}
              </label>
              <input
                id="ep-releasedelay"
                type="number"
                min={0}
                step={0.1}
                placeholder="0"
                value={releaseDelayS ? secondsToMinutes(releaseDelayS) : ""}
                onChange={(e) => setReleaseDelayS(minutesToSeconds(Number(e.target.value)))}
                onBlur={() => commitEdit({ releaseDelayS })}
                className={inputCls}
              />
            </div>
            {profile?.learned && (
              <div className="text-caption text-text-tertiary pb-1">
                {t("energyProfile.learned", {
                  power: formatPower(profile.learned.watts),
                  runs: profile.learned.runs,
                })}
              </div>
            )}
            {saving && <Loader2 size={14} className="animate-spin text-text-tertiary mb-2" />}
          </div>

          {!profile &&
            (complete ? (
              <button
                onClick={() =>
                  void commit({ cls, watts, toleratedImportW, minOnS, minOffS, releaseDelayS })
                }
                disabled={saving}
                className="mt-3 px-3 py-1.5 bg-primary-fill text-white text-small font-medium rounded-sm hover:bg-primary-fill-hover disabled:opacity-50"
              >
                {t("energyProfile.save")}
              </button>
            ) : (
              <p className="text-caption text-text-tertiary mt-2">{t("energyProfile.completeToEnable")}</p>
            ))}
        </>
      )}

      {error && <p className="text-caption text-error mt-2">{error}</p>}
    </ConfigRow>
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
