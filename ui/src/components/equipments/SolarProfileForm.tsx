import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SolarPlane } from "../../types";
import { updateEquipment } from "../../api";
import { CARDINAL_AZIMUTHS, validateSolarProfile } from "./solarProfileValidation";

/**
 * Declare the array (spec 160, FR9).
 *
 * A list of planes, not a list of panels: the panel count adds nothing the peak
 * power does not already carry. What genuinely changes the physics is panels
 * facing different ways, which is why a second plane is possible at all — but
 * "Add a plane" only appears once the first is filled, so a single-pitch roof is
 * three fields and the word "plane" is never spoken.
 *
 * Shading is deliberately not asked for: the model measures it.
 */

/**
 * All eight, not just the sunny ones: east/west roofs are the modern standard
 * and north-facing arrays exist.
 *
 * Taken from the same table the backend validates against, so the buttons can
 * never offer a bearing the API would refuse.
 */
const CARDINALS = Object.entries(CARDINAL_AZIMUTHS).map(([key, azimuth]) => ({ key, azimuth }));

const EMPTY_PLANE: SolarPlane = { tiltDeg: 30, azimuthDeg: 180, peakWc: 0 };

interface SolarProfileFormProps {
  equipmentId: string;
  planes: SolarPlane[];
  /** Spec 161 — the array has been in this configuration since. */
  since?: string;
  onSaved: () => void;
}

export function SolarProfileForm({ equipmentId, planes, since, onSaved }: SolarProfileFormProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<SolarPlane[]>(planes.length > 0 ? planes : [EMPTY_PLANE]);
  const [saving, setSaving] = useState(false);
  const [sinceDraft, setSinceDraft] = useState<string>(since ? since.slice(0, 10) : "");
  const [error, setError] = useState<string | null>(null);
  /** "planeIndex:field" for every field the validator refused. */
  const [badFields, setBadFields] = useState<Set<string>>(new Set());

  const totalWc = draft.reduce((sum, p) => sum + (Number.isFinite(p.peakWc) ? p.peakWc : 0), 0);
  const nothingToSave = draft.length === 0;
  const firstFilled = draft.length > 0 && draft[0].peakWc > 0;

  function patch(index: number, changes: Partial<SolarPlane>): void {
    setDraft((current) => current.map((p, i) => (i === index ? { ...p, ...changes } : p)));
  }

  async function save(): Promise<void> {
    setError(null);

    // Validated here with the same rules the backend applies. Fastify's body
    // schema rejects an out-of-range value before the handler runs, so the
    // structured per-field detail never comes back over the wire — checking
    // first is the only way to name the offending field, which FR9 requires.
    //
    // Every drafted plane is validated, none filtered out: a half-typed row must
    // be reported, never quietly dropped. Filtering first would let a cleared
    // peak power empty the list, validate clean, and send `null` — deleting a
    // working declaration because someone was mid-edit.
    const errors = validateSolarProfile({ planes: draft });
    if (errors.length > 0) {
      setBadFields(new Set(errors.map((e) => `${e.plane}:${e.field}`)));
      setError(errors[0].message);
      return;
    }
    setBadFields(new Set());

    const planesToSave = draft;

    setSaving(true);
    try {
      await updateEquipment(equipmentId, {
        solarProfile: {
          planes: planesToSave,
          // Empty means "no extra information", which is not the same as a bad
          // date: the backfill window falls back to its own bound either way.
          since: sinceDraft.trim() === "" ? undefined : sinceDraft,
        },
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Withdraw the declaration entirely.
   *
   * Sends an explicit null rather than an empty plane list: the manager treats
   * undefined as "leave alone" and null as "clear", and only the second stops
   * the forecast and hides the panel.
   */
  async function withdraw(): Promise<void> {
    setError(null);
    setSaving(true);
    try {
      await updateEquipment(equipmentId, { solarProfile: null });
      setDraft([EMPTY_PLANE]);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // Card chrome, title and help live in `SolarInstallationSettings` (spec
  // 163), the form's only remaining host: bare fields here.
  return (
    <div>
      <div className="flex flex-col gap-4">
        {draft.map((plane, index) => (
          <div
            key={index}
            className={index > 0 ? "border-t border-border-light pt-4" : undefined}
          >
            {draft.length > 1 && (
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-medium text-text-secondary">
                  {t("equipments.solar.planeN", { n: index + 1 })}
                </span>
                <button
                  type="button"
                  onClick={() => setDraft((c) => c.filter((_, i) => i !== index))}
                  className="text-text-tertiary hover:text-error p-1 rounded-[6px]"
                  aria-label={t("common.remove")}
                >
                  <Trash2 size={14} strokeWidth={1.5} />
                </button>
              </div>
            )}

            <label className="block text-[12px] text-text-secondary mb-1">
              {t("equipments.solar.orientation")}
            </label>
            <div className="flex flex-wrap gap-1 mb-2">
              {CARDINALS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => patch(index, { azimuthDeg: c.azimuth })}
                  className={`px-2.5 py-1 rounded-[6px] text-[12px] font-medium border ${
                    plane.azimuthDeg === c.azimuth
                      ? "border-primary bg-primary-light text-primary"
                      : "border-border text-text-secondary hover:border-primary"
                  }`}
                >
                  {t(`equipments.solar.cardinal.${c.key}`)}
                </button>
              ))}
              <input
                type="number"
                min={0}
                max={359}
                value={plane.azimuthDeg}
                onChange={(e) => patch(index, { azimuthDeg: toDegrees(e.target.value) })}
                className={`w-20 px-2 py-1 rounded-[6px] border bg-background text-[12px] tabular-nums ${
                  badFields.has(`${index}:azimuthDeg`) ? "border-error" : "border-border"
                }`}
                aria-label={t("equipments.solar.orientation")}
              />
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label
                  htmlFor={`tilt-${index}`}
                  className="block text-[12px] text-text-secondary mb-1"
                >
                  {t("equipments.solar.tilt")}
                </label>
                <input
                  id={`tilt-${index}`}
                  type="number"
                  min={0}
                  max={90}
                  value={plane.tiltDeg}
                  onChange={(e) => patch(index, { tiltDeg: toDegrees(e.target.value) })}
                  className={`w-full px-2 py-1.5 rounded-[6px] border bg-background text-[13px] tabular-nums ${
                    badFields.has(`${index}:tiltDeg`) ? "border-error" : "border-border"
                  }`}
                />
                <p className="text-[11px] text-text-tertiary mt-1">
                  {t("equipments.solar.tiltHint")}
                </p>
              </div>
              <div className="flex-1">
                <label
                  htmlFor={`peak-${index}`}
                  className="block text-[12px] text-text-secondary mb-1"
                >
                  {t("equipments.solar.peak")}
                </label>
                <input
                  id={`peak-${index}`}
                  type="number"
                  min={0}
                  value={plane.peakWc || ""}
                  onChange={(e) => patch(index, { peakWc: toDegrees(e.target.value) })}
                  className={`w-full px-2 py-1.5 rounded-[6px] border bg-background text-[13px] tabular-nums ${
                    badFields.has(`${index}:peakWc`) ? "border-error" : "border-border"
                  }`}
                />
                <p className="text-[11px] text-text-tertiary mt-1">
                  {t("equipments.solar.peakHint")}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Only offered once the first plane is real, so a single-pitch roof
          never has to read about planes at all. */}
      {firstFilled && (
        <button
          type="button"
          onClick={() => setDraft((c) => [...c, { ...EMPTY_PLANE }])}
          className="mt-4 flex items-center gap-1.5 text-[12px] text-primary hover:underline"
        >
          <Plus size={14} strokeWidth={1.5} />
          {t("equipments.solar.addPlane")}
        </button>
      )}

      {/* Spec 161 — only ever used to bound a fit over past production. Fitted
          across a capacity change the gain describes neither array, and this
          date is the one thing only the household knows. */}
      <div className="mt-4 pt-4 border-t border-border-light">
        <label htmlFor="solar-since" className="block text-[12px] text-text-secondary mb-1">
          {t("equipments.solar.since")}
        </label>
        <input
          id="solar-since"
          type="date"
          value={sinceDraft}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setSinceDraft(e.target.value)}
          className="px-2 py-1.5 rounded-[6px] border border-border bg-background text-[13px] tabular-nums"
        />
        <p className="text-[11px] text-text-tertiary mt-1">{t("equipments.solar.sinceHint")}</p>
      </div>

      {error && <p className="mt-3 text-[12px] text-error">{error}</p>}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || nothingToSave}
          className="px-3 py-1.5 rounded-[6px] bg-primary text-white text-[13px] font-medium disabled:opacity-50"
        >
          {saving ? t("common.saving") : t("common.save")}
        </button>
        {/* FR9 — a declaration has to be undoable. Without this the panel is
            permanent on every production meter once saved, and the per-plane
            delete cannot reach zero because it hides on the last one. */}
        {planes.length > 0 && (
          <button
            type="button"
            onClick={withdraw}
            disabled={saving}
            className="text-[12px] text-text-tertiary hover:text-error disabled:opacity-50"
          >
            {t("equipments.solar.withdraw")}
          </button>
        )}
        {totalWc > 0 && (
          <span className="text-[12px] text-text-tertiary tabular-nums font-mono">
            {t("equipments.solar.total", { wc: totalWc })}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A number input's value, as a number.
 *
 * A cleared field yields "", which `Number("")` turns into 0 — silently
 * flattening a tilt or pointing an array due north mid-retype. NaN is kept
 * instead, which the validator refuses with the field named.
 */
function toDegrees(raw: string): number {
  return raw.trim() === "" ? Number.NaN : Number(raw);
}
