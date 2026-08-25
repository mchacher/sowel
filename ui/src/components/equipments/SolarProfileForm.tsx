import { useState } from "react";
import { Plus, Sun, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SolarPlane } from "../../types";
import { updateEquipment } from "../../api";

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

/** All eight, not just the sunny ones: east/west and north arrays exist. */
const CARDINALS: { key: string; azimuth: number }[] = [
  { key: "N", azimuth: 0 },
  { key: "NE", azimuth: 45 },
  { key: "E", azimuth: 90 },
  { key: "SE", azimuth: 135 },
  { key: "S", azimuth: 180 },
  { key: "SW", azimuth: 225 },
  { key: "W", azimuth: 270 },
  { key: "NW", azimuth: 315 },
];

const EMPTY_PLANE: SolarPlane = { tiltDeg: 30, azimuthDeg: 180, peakWc: 0 };

interface SolarProfileFormProps {
  equipmentId: string;
  planes: SolarPlane[];
  onSaved: () => void;
}

export function SolarProfileForm({ equipmentId, planes, onSaved }: SolarProfileFormProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<SolarPlane[]>(planes.length > 0 ? planes : [EMPTY_PLANE]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalWc = draft.reduce((sum, p) => sum + (p.peakWc || 0), 0);
  const firstFilled = draft.length > 0 && draft[0].peakWc > 0;

  function patch(index: number, changes: Partial<SolarPlane>): void {
    setDraft((current) => current.map((p, i) => (i === index ? { ...p, ...changes } : p)));
  }

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const planesToSave = draft.filter((p) => p.peakWc > 0);
      await updateEquipment(equipmentId, {
        solarProfile: planesToSave.length > 0 ? { planes: planesToSave } : null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-6 bg-surface rounded-[10px] border border-border p-4">
      <div className="flex items-center gap-2 mb-1">
        <Sun size={16} strokeWidth={1.5} className="text-accent" />
        <h3 className="text-[14px] font-semibold text-text">
          {t("equipments.solar.title")}
        </h3>
      </div>
      <p className="text-[12px] text-text-secondary mb-4">{t("equipments.solar.help")}</p>

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
                onChange={(e) => patch(index, { azimuthDeg: Number(e.target.value) })}
                className="w-20 px-2 py-1 rounded-[6px] border border-border bg-background text-[12px] tabular-nums"
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
                  onChange={(e) => patch(index, { tiltDeg: Number(e.target.value) })}
                  className="w-full px-2 py-1.5 rounded-[6px] border border-border bg-background text-[13px] tabular-nums"
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
                  onChange={(e) => patch(index, { peakWc: Number(e.target.value) })}
                  className="w-full px-2 py-1.5 rounded-[6px] border border-border bg-background text-[13px] tabular-nums"
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

      {error && <p className="mt-3 text-[12px] text-error">{error}</p>}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 rounded-[6px] bg-primary text-white text-[13px] font-medium disabled:opacity-50"
        >
          {saving ? t("common.saving") : t("common.save")}
        </button>
        {totalWc > 0 && (
          <span className="text-[12px] text-text-tertiary tabular-nums font-mono">
            {t("equipments.solar.total", { wc: totalWc })}
          </span>
        )}
      </div>
    </div>
  );
}
