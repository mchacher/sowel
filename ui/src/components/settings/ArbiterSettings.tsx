import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Scale, ChevronDown, ChevronUp, ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import { getSettings, updateSettings } from "../../api";
import { useEquipments } from "../../store/useEquipments";
import { InfoTooltip } from "../InfoTooltip";

/**
 * Spec 140 — arbiter card in Settings → Administration. Enable switch, the
 * user-owned priority list (up/down, no drag dependency), thresholds under an
 * advanced fold. The arbiter reads the MAIN ENERGY METER (grid export), so the
 * card gates on that — not on a production meter, which is only used for the
 * display bar. A home whose solar shows up as grid export (one bidirectional
 * clamp, no separate production meter) can and should enable it.
 */
const PREFIX = "energy.arbiter.";
/** Each threshold with a hard minimum, so clearing a field can never persist a
 *  0 that silently kills the feature (staleAfterS=0 → permanently degraded). */
const ADVANCED: Array<{ key: string; fallback: number; min: number }> = [
  { key: "engageMarginW", fallback: 100, min: 0 },
  { key: "engageHoldS", fallback: 120, min: 5 },
  { key: "releaseHoldS", fallback: 600, min: 5 },
  { key: "smoothingS", fallback: 60, min: 1 },
  { key: "overrideTtlS", fallback: 7200, min: 60 },
  { key: "staleAfterS", fallback: 300, min: 30 },
  { key: "divergenceConfirmS", fallback: 60, min: 5 },
];

function parsePriority(raw: string | undefined): string[] {
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function ArbiterSettings() {
  const { t } = useTranslation();
  const equipments = useEquipments((s) => s.equipments);
  const fetchEquipments = useEquipments((s) => s.fetchEquipments);
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    fetchEquipments();
    getSettings()
      .then(setSettings)
      .catch(() => setSettings({}));
  }, [fetchEquipments]);

  const hasGridMeter = useMemo(
    () => equipments.some((e) => e.type === "main_energy_meter"),
    [equipments],
  );
  const profiled = useMemo(() => equipments.filter((e) => e.energyProfile), [equipments]);

  const enabled = settings?.[PREFIX + "enabled"] === "true";

  // Displayed order = persisted ids (that are still profiled) then any profiled
  // id not yet persisted, appended at the bottom.
  const priority: string[] = useMemo(() => {
    const ids = parsePriority(settings?.[PREFIX + "priority"]);
    const kept = ids.filter((id) => profiled.some((e) => e.id === id));
    const missing = profiled.map((e) => e.id).filter((id) => !kept.includes(id));
    return [...kept, ...missing];
  }, [settings, profiled]);

  const put = async (patch: Record<string, string>) => {
    setSaving(true);
    setError(null);
    try {
      await updateSettings(patch);
      setSettings((prev) => ({ ...(prev ?? {}), ...patch }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  // Persist the displayed order whenever it drifts from what is stored — new
  // profiled loads appear appended, and the arbiter honors ONLY the stored
  // list (anything absent ties at the bottom). Without this, the numbered list
  // shown to the user is not the order the arbiter actually uses.
  useEffect(() => {
    if (settings === null || profiled.length === 0) return;
    const stored = parsePriority(settings[PREFIX + "priority"]).filter((id) =>
      profiled.some((e) => e.id === id),
    );
    if (JSON.stringify(stored) !== JSON.stringify(priority)) {
      void put({ [PREFIX + "priority"]: JSON.stringify(priority) });
    }
  }, [settings, profiled, priority]);

  const move = (index: number, dir: -1 | 1) => {
    const next = [...priority];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    void put({ [PREFIX + "priority"]: JSON.stringify(next) });
  };

  const commitThreshold = (key: string, min: number, fallback: number, el: HTMLInputElement) => {
    const v = Number(el.value);
    if (el.value.trim() === "" || !Number.isFinite(v) || v < min) {
      // Refuse an empty/too-low value (would disable the feature); snap back.
      el.value = String(Number(settings?.[PREFIX + key] ?? fallback));
      return;
    }
    void put({ [PREFIX + key]: String(Math.round(v)) });
  };

  if (settings === null) {
    return (
      <div className="bg-surface border border-border rounded-[10px] p-5">
        <div className="flex items-center gap-2 text-text-secondary text-[13px]">
          <Loader2 size={14} className="animate-spin" />
          {t("common.loading")}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-[10px] p-5">
      <div className="flex items-center gap-2 mb-1">
        <Scale size={18} strokeWidth={1.5} className="text-text-secondary" />
        <h2 className="text-[15px] font-semibold text-text">{t("arbiter.title")}</h2>
        {hasGridMeter && (
          <label className="ml-auto flex items-center gap-2 text-[12px] text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              disabled={saving}
              onChange={(e) => void put({ [PREFIX + "enabled"]: String(e.target.checked) })}
            />
            {t("arbiter.enable")}
          </label>
        )}
      </div>
      <p className="text-[12px] text-text-tertiary mb-4">{t("arbiter.hint")}</p>

      {!hasGridMeter ? (
        <p className="text-[13px] text-text-secondary">{t("arbiter.noGridMeter")}</p>
      ) : (
        <>
          <h3 className="text-[13px] font-medium text-text mb-2">{t("arbiter.priorityTitle")}</h3>
          {profiled.length === 0 ? (
            <p className="text-[12px] text-text-tertiary mb-3">{t("arbiter.noProfiles")}</p>
          ) : (
            <ul className="mb-3 space-y-1">
              {priority.map((id, i) => {
                const eq = profiled.find((e) => e.id === id);
                if (!eq) return null;
                return (
                  <li
                    key={id}
                    className="flex items-center gap-2 px-3 py-1.5 border border-border-light rounded-md text-[13px] text-text"
                  >
                    <span className="text-text-tertiary text-[12px] w-4">{i + 1}.</span>
                    <span className="truncate">{eq.name}</span>
                    <span className="text-[11px] text-text-tertiary">
                      {t(`energyProfile.${eq.energyProfile?.class ?? "deferrable"}`)}
                      {" · "}
                      <span className="font-mono">{eq.energyProfile?.nominalPowerW} W</span>
                    </span>
                    <span className="ml-auto flex gap-1">
                      <button
                        onClick={() => move(i, -1)}
                        disabled={i === 0 || saving}
                        className="p-1 text-text-tertiary hover:text-text disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
                        aria-label={t("arbiter.moveUpNamed", { name: eq.name })}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        onClick={() => move(i, 1)}
                        disabled={i === priority.length - 1 || saving}
                        className="p-1 text-text-tertiary hover:text-text disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
                        aria-label={t("arbiter.moveDownNamed", { name: eq.name })}
                      >
                        <ArrowDown size={14} />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1 text-[12px] text-primary hover:text-primary-hover"
          >
            {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {t("arbiter.advanced")}
          </button>
          {showAdvanced && (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {ADVANCED.map(({ key, fallback, min }) => (
                <div key={key}>
                  <div className="flex items-center gap-1 mb-1">
                    <label className="text-[11px] text-text-tertiary" htmlFor={`arb-${key}`}>
                      {t(`arbiter.settings.${key}`)}
                    </label>
                    <InfoTooltip
                      text={t(`arbiter.settings.${key}Help`)}
                      label={t(`arbiter.settings.${key}`)}
                    />
                  </div>
                  <input
                    id={`arb-${key}`}
                    type="number"
                    min={min}
                    defaultValue={Number(settings[PREFIX + key] ?? fallback)}
                    onBlur={(e) => commitThreshold(key, min, fallback, e.target)}
                    className="w-full px-2 py-1 border border-border rounded text-[13px] text-text bg-background"
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {error && <p className="text-[12px] text-red-500 mt-2">{error}</p>}
    </div>
  );
}
