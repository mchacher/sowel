import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Scale, ChevronDown, ChevronUp, ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import { getSettings, updateSettings } from "../../api";
import { useEquipments } from "../../store/useEquipments";

/**
 * Spec 140 — arbiter card in Settings → Administration. Enable switch, the
 * user-owned priority list (up/down, no drag dependency), thresholds under
 * an advanced fold. On installations without a production meter the card
 * explains why arbitration has nothing to do instead of offering a switch
 * that would animate an empty timeline.
 */
const PREFIX = "energy.arbiter.";
const ADVANCED: Array<{ key: string; fallback: number }> = [
  { key: "engageMarginW", fallback: 100 },
  { key: "engageHoldS", fallback: 120 },
  { key: "releaseHoldS", fallback: 600 },
  { key: "smoothingS", fallback: 60 },
  { key: "overrideTtlS", fallback: 7200 },
  { key: "staleAfterS", fallback: 300 },
  { key: "divergenceConfirmS", fallback: 60 },
];

export function ArbiterSettings() {
  const { t } = useTranslation();
  const equipments = useEquipments((s) => s.equipments);
  const fetchEquipments = useEquipments((s) => s.fetchEquipments);
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    fetchEquipments();
    getSettings()
      .then(setSettings)
      .catch(() => setSettings({}));
  }, [fetchEquipments]);

  const hasProduction = useMemo(
    () => equipments.some((e) => e.type === "energy_production_meter" || e.type === "solar_panel"),
    [equipments],
  );
  const profiled = useMemo(() => equipments.filter((e) => e.energyProfile), [equipments]);

  const enabled = settings?.[PREFIX + "enabled"] === "true";
  const priority: string[] = useMemo(() => {
    try {
      const raw = settings?.[PREFIX + "priority"];
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      const ids = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
      // Profiled equipments missing from the list append at the bottom (most
      // sacrificable position) until the user moves them.
      const missing = profiled.map((e) => e.id).filter((id) => !ids.includes(id));
      return [...ids.filter((id) => profiled.some((e) => e.id === id)), ...missing];
    } catch {
      return profiled.map((e) => e.id);
    }
  }, [settings, profiled]);

  const put = async (patch: Record<string, string>) => {
    setSaving(true);
    try {
      await updateSettings(patch);
      setSettings((prev) => ({ ...(prev ?? {}), ...patch }));
    } finally {
      setSaving(false);
    }
  };

  const move = (index: number, dir: -1 | 1) => {
    const next = [...priority];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    void put({ [PREFIX + "priority"]: JSON.stringify(next) });
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
        {hasProduction && (
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

      {!hasProduction ? (
        <p className="text-[13px] text-text-secondary">{t("arbiter.noProduction")}</p>
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
                        className="p-1 text-text-tertiary hover:text-text disabled:opacity-30"
                        aria-label={t("arbiter.moveUp")}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        onClick={() => move(i, 1)}
                        disabled={i === priority.length - 1 || saving}
                        className="p-1 text-text-tertiary hover:text-text disabled:opacity-30"
                        aria-label={t("arbiter.moveDown")}
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
              {ADVANCED.map(({ key, fallback }) => (
                <div key={key}>
                  <label className="block text-[11px] text-text-tertiary mb-1">
                    {t(`arbiter.settings.${key}`)}
                  </label>
                  <input
                    type="number"
                    defaultValue={Number(settings[PREFIX + key] ?? fallback)}
                    onBlur={(e) => void put({ [PREFIX + key]: e.target.value })}
                    className="w-full px-2 py-1 border border-border rounded text-[13px] text-text bg-background"
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
