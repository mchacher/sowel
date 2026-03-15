import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Zap, Plus, Trash2, Loader2 } from "lucide-react";
import { getTariffConfig, saveTariffConfig } from "../../api";
import type { TariffConfig, TariffSlot } from "../../types";

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const HP_COLOR = "#4F7BE8";
const HC_COLOR = "#93B5F0";
const TOTAL_MINUTES = 1440;

function defaultSlots(): TariffSlot[] {
  return [
    { start: "06:00", end: "22:00", tariff: "hp" },
    { start: "22:00", end: "06:00", tariff: "hc" },
  ];
}

function emptyConfig(): TariffConfig {
  return {
    schedules: [{ days: [...ALL_DAYS], slots: defaultSlots() }],
    prices: { hp: 0, hc: 0 },
  };
}

/** Parse "HH:MM" to minutes since midnight */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Format minutes to "HHhMM" for display */
function minutesToLabel(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/** Build a flat minute-by-minute array of HP/HC for the 24h timeline */
function buildTimeline(slots: TariffSlot[]): Array<"hp" | "hc" | null> {
  const timeline = new Array<"hp" | "hc" | null>(TOTAL_MINUTES).fill(null);
  for (const slot of slots) {
    const start = timeToMinutes(slot.start);
    let end = timeToMinutes(slot.end);
    if (end === 0) end = TOTAL_MINUTES;

    if (end > start) {
      // Normal range
      for (let i = start; i < end; i++) timeline[i] = slot.tariff;
    } else {
      // Midnight wrap: e.g. 17:04 → 00:04
      for (let i = start; i < TOTAL_MINUTES; i++) timeline[i] = slot.tariff;
      for (let i = 0; i < end; i++) timeline[i] = slot.tariff;
    }
  }
  return timeline;
}

/** Convert timeline to contiguous segments for rendering */
interface Segment {
  startMin: number;
  endMin: number;
  tariff: "hp" | "hc" | null;
}

function timelineToSegments(timeline: Array<"hp" | "hc" | null>): Segment[] {
  const segments: Segment[] = [];
  let current: Segment | null = null;

  for (let i = 0; i < TOTAL_MINUTES; i++) {
    const t = timeline[i];
    if (!current || current.tariff !== t) {
      if (current) segments.push(current);
      current = { startMin: i, endMin: i + 1, tariff: t };
    } else {
      current.endMin = i + 1;
    }
  }
  if (current) segments.push(current);
  return segments;
}

/** Timeline bar component */
function TariffTimeline({ slots }: { slots: TariffSlot[] }) {
  const { t } = useTranslation();
  const timeline = buildTimeline(slots);
  const segments = timelineToSegments(timeline);

  // Collect transition labels (skip last 0h — redundant)
  const labels: Array<{ min: number; text: string }> = [];
  labels.push({ min: 0, text: minutesToLabel(0) });
  for (let i = 1; i < segments.length; i++) {
    labels.push({ min: segments[i].startMin, text: minutesToLabel(segments[i].startMin) });
  }

  // Split labels into above (even) and below (odd)
  const aboveLabels = labels.filter((_, i) => i % 2 === 0);
  const belowLabels = labels.filter((_, i) => i % 2 === 1);

  return (
    <div className="mb-4">
      {/* Labels above the bar */}
      <div className="relative h-4 mb-1">
        {aboveLabels.map((label, i) => (
          <span
            key={i}
            className="absolute text-[10px] text-text-secondary -translate-x-1/2 bottom-0"
            style={{ left: `${(label.min / TOTAL_MINUTES) * 100}%` }}
          >
            {label.text}
          </span>
        ))}
      </div>

      {/* Bar */}
      <div className="flex h-7 rounded-md overflow-hidden">
        {segments.map((seg, i) => {
          const widthPct = ((seg.endMin - seg.startMin) / TOTAL_MINUTES) * 100;
          const color =
            seg.tariff === "hp" ? HP_COLOR : seg.tariff === "hc" ? HC_COLOR : "#e5e7eb";
          return (
            <div
              key={i}
              style={{ width: `${widthPct}%`, backgroundColor: color }}
              className="transition-all"
            />
          );
        })}
      </div>

      {/* Labels below the bar */}
      <div className="relative h-4 mt-1">
        {belowLabels.map((label, i) => (
          <span
            key={i}
            className="absolute text-[10px] text-text-secondary -translate-x-1/2 top-0"
            style={{ left: `${(label.min / TOTAL_MINUTES) * 100}%` }}
          >
            {label.text}
          </span>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 text-[12px] text-text-secondary">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: HP_COLOR }} />
          {t("energy.peakHours")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: HC_COLOR }} />
          {t("energy.offPeakHours")}
        </span>
      </div>
    </div>
  );
}

export function TariffSettings() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<TariffConfig>(emptyConfig());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTariffConfig()
      .then((c) => {
        if (c.schedules.length > 0) setConfig(c);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Always work with schedule index 0 (single schedule for all days)
  const slots = config.schedules[0]?.slots ?? [];

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      // Ensure all days are included in the single schedule
      const toSave: TariffConfig = {
        ...config,
        schedules: [{ days: [...ALL_DAYS], slots }],
      };
      await saveTariffConfig(toSave);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("tariff.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const updateSlot = (slotIdx: number, patch: Partial<TariffSlot>) => {
    setConfig((prev) => {
      const schedules = [...prev.schedules];
      const newSlots = [...schedules[0].slots];
      newSlots[slotIdx] = { ...newSlots[slotIdx], ...patch };
      schedules[0] = { ...schedules[0], slots: newSlots };
      return { ...prev, schedules };
    });
  };

  const addSlot = () => {
    setConfig((prev) => {
      const schedules = [...prev.schedules];
      const newSlots = [...schedules[0].slots, { start: "00:00", end: "00:00", tariff: "hp" as const }];
      schedules[0] = { ...schedules[0], slots: newSlots };
      return { ...prev, schedules };
    });
  };

  const removeSlot = (slotIdx: number) => {
    setConfig((prev) => {
      const schedules = [...prev.schedules];
      const newSlots = schedules[0].slots.filter((_, i) => i !== slotIdx);
      schedules[0] = { ...schedules[0], slots: newSlots };
      return { ...prev, schedules };
    });
  };

  if (loading) {
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
      <div className="flex items-center gap-2 mb-4">
        <Zap size={18} strokeWidth={1.5} className="text-text-secondary" />
        <h2 className="text-[15px] font-semibold text-text">{t("tariff.title")}</h2>
      </div>

      {/* Prices */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        <div>
          <label className="block text-[12px] text-text-secondary mb-1">
            {t("tariff.priceHp")}
          </label>
          <input
            type="number"
            step="0.0001"
            min="0"
            value={config.prices.hp || ""}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                prices: { ...prev.prices, hp: parseFloat(e.target.value) || 0 },
              }))
            }
            className="w-full px-3 py-1.5 border border-border rounded-md text-[13px] text-text bg-background"
          />
        </div>
        <div>
          <label className="block text-[12px] text-text-secondary mb-1">
            {t("tariff.priceHc")}
          </label>
          <input
            type="number"
            step="0.0001"
            min="0"
            value={config.prices.hc || ""}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                prices: { ...prev.prices, hc: parseFloat(e.target.value) || 0 },
              }))
            }
            className="w-full px-3 py-1.5 border border-border rounded-md text-[13px] text-text bg-background"
          />
        </div>
      </div>

      {/* Visual timeline */}
      <TariffTimeline slots={slots} />

      {/* Time slots */}
      <div className="mb-5 border border-border-light rounded-lg p-4">
        <h3 className="text-[13px] font-medium text-text mb-3">
          {t("tariff.timeSlots")}
        </h3>

        <div className="space-y-2">
          {slots.map((slot, slotIdx) => (
            <div key={slotIdx} className="flex items-center gap-2">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: slot.tariff === "hp" ? HP_COLOR : HC_COLOR }}
              />
              <input
                type="time"
                step="60"
                value={slot.start}
                onChange={(e) => updateSlot(slotIdx, { start: e.target.value })}
                className="px-2 py-1 border border-border rounded text-[13px] text-text bg-background"
              />
              <span className="text-text-tertiary text-[12px]">→</span>
              <input
                type="time"
                step="60"
                value={slot.end}
                onChange={(e) => updateSlot(slotIdx, { end: e.target.value })}
                className="px-2 py-1 border border-border rounded text-[13px] text-text bg-background"
              />
              <select
                value={slot.tariff}
                onChange={(e) =>
                  updateSlot(slotIdx, { tariff: e.target.value as "hp" | "hc" })
                }
                className="px-2 py-1 border border-border rounded text-[13px] text-text bg-background"
              >
                <option value="hp">{t("energy.peakHours")}</option>
                <option value="hc">{t("energy.offPeakHours")}</option>
              </select>
              {slots.length > 1 && (
                <button
                  onClick={() => removeSlot(slotIdx)}
                  className="p-1 text-text-tertiary hover:text-red-500 transition-colors"
                  title={t("tariff.delete")}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={addSlot}
          className="mt-2 flex items-center gap-1 text-[12px] text-primary hover:text-primary-hover transition-colors"
        >
          <Plus size={14} />
          {t("tariff.addSlot")}
        </button>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 bg-primary text-white text-[13px] font-medium rounded-md hover:bg-primary-hover disabled:opacity-50 transition-colors"
        >
          {saving ? (
            <span className="flex items-center gap-1.5">
              <Loader2 size={14} className="animate-spin" />
              {t("tariff.saving")}
            </span>
          ) : (
            t("tariff.save")
          )}
        </button>
        {saved && (
          <span className="text-[12px] text-green-600">{t("tariff.saved")}</span>
        )}
        {error && (
          <span className="text-[12px] text-red-500">{error}</span>
        )}
      </div>
    </div>
  );
}
