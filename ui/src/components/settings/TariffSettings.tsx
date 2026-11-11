import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Zap, Plus, Trash2, Loader2, Info } from "lucide-react";
import { getPriceFileStatus, getTariffConfig, saveTariffConfig } from "../../api";
import { isTariffSaved } from "../../lib/tariff";
import type { PriceFileStatus, TariffConfig, TariffContract, TariffSlot } from "../../types";
import { TariffContractBlock } from "./TariffContractBlock";
import { TariffPriceHistory } from "./TariffPriceHistory";
import { TariffPriceProposals } from "./TariffPriceProposals";

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
// Spec 196 (FR-E) — the energy chart tokens, so the tariff strip follows the theme.
const HP_COLOR = "var(--color-energy-hp)";
const HC_COLOR = "var(--color-energy-hc)";
const TOTAL_MINUTES = 1440;

function defaultSlots(): TariffSlot[] {
  return [
    { start: "06:00", end: "22:00", tariff: "hp" },
    { start: "22:00", end: "06:00", tariff: "hc" },
  ];
}

/**
 * Standard HP/HC schedule shown as a *proposal* before anything is saved.
 * Deliberately not empty: a fresh install lands on sensible, ready-to-save
 * hours. The unsaved banner (issue #384) tells this apart from a persisted
 * tariff so the two are never confused.
 */
function proposedConfig(): TariffConfig {
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
            className="absolute text-micro text-text-secondary -translate-x-1/2 bottom-0"
            style={{ left: `${(label.min / TOTAL_MINUTES) * 100}%` }}
          >
            {label.text}
          </span>
        ))}
      </div>

      {/* Bar */}
      <div className="flex h-7 rounded-sm overflow-hidden">
        {segments.map((seg, i) => {
          const widthPct = ((seg.endMin - seg.startMin) / TOTAL_MINUTES) * 100;
          const color =
            seg.tariff === "hp" ? HP_COLOR : seg.tariff === "hc" ? HC_COLOR : "var(--color-border)";
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
            className="absolute text-micro text-text-secondary -translate-x-1/2 top-0"
            style={{ left: `${(label.min / TOTAL_MINUTES) * 100}%` }}
          >
            {label.text}
          </span>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 text-caption text-text-secondary">
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
  const [config, setConfig] = useState<TariffConfig>(proposedConfig());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether a tariff is actually persisted. Until it is, the form shows the
  // proposal and warns that nothing is saved (issue #384). The server returns
  // an empty `schedules` array when `energy.tariff` is absent.
  const [configured, setConfigured] = useState(false);
  // Spec 202 — the contract block reports what it read and saved: the price
  // block needs the contract type (one price or two) and the subscribed power.
  const [contract, setContract] = useState<TariffContract | null>(null);
  // Spec 203 — where the read of the price file stands. Held here: the
  // contract block says it, the price block lists the prices it left to confirm.
  const [priceFile, setPriceFile] = useState<PriceFileStatus | null>(null);
  // Bumped when the price file may have added versions: the price list reads again.
  const [pricesKey, setPricesKey] = useState(0);
  const reloadPrices = useCallback(() => setPricesKey((k) => k + 1), []);
  // A version edited by hand changes which prices of the file are still new.
  const rereadPriceFile = useCallback(() => {
    getPriceFileStatus()
      .then(setPriceFile)
      .catch(() => {});
  }, []);

  useEffect(() => {
    getTariffConfig()
      .then((c) => {
        if (isTariffSaved(c)) {
          setConfig(c);
          setConfigured(true);
        }
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
      // The schedule only (spec 202: prices have their own history), with all
      // days included in the single schedule.
      await saveTariffConfig({ schedules: [{ days: [...ALL_DAYS], slots }] });
      setConfigured(true);
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
      const newSlots = [
        ...schedules[0].slots,
        { start: "00:00", end: "00:00", tariff: "hp" as const },
      ];
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
      <div className="card p-5">
        <div className="flex items-center gap-2 text-text-secondary text-small">
          <Loader2 size={14} className="animate-spin" />
          {t("common.loading")}
        </div>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Zap size={18} strokeWidth={1.5} className="text-text-secondary" />
        <h2 className="text-lead font-semibold text-text">{t("tariff.title")}</h2>
      </div>

      <TariffContractBlock
        onContract={setContract}
        status={priceFile}
        onStatus={setPriceFile}
        onFileRead={reloadPrices}
      />

      <hr className="border-0 border-t border-border-light my-5" />

      <TariffPriceHistory
        contractType={contract?.contractType ?? "hphc"}
        contractKva={contract?.kva ?? null}
        reloadKey={pricesKey}
        onVersionsChange={rereadPriceFile}
        notice={
          contract &&
          priceFile && (
            <TariffPriceProposals
              supplier={contract.supplier}
              status={priceFile}
              onStatus={setPriceFile}
              onApplied={reloadPrices}
            />
          )
        }
      />

      <hr className="border-0 border-t border-border-light my-5" />

      <h3 className="text-small font-medium text-text mb-2">{t("tariff.schedule.title")}</h3>

      {/* Issue #384 — the form is pre-filled with the standard schedule as a
          proposal; without this banner an unsaved default looks identical to a
          persisted tariff. Shown only until a tariff is actually saved. */}
      {!configured && (
        <div
          role="status"
          className="flex items-start gap-2 mb-4 px-3 py-2 rounded-md bg-primary-light border border-primary/20 text-caption text-text-secondary"
        >
          <Info size={14} strokeWidth={1.5} className="mt-0.5 flex-shrink-0 text-primary" />
          <span>{t("tariff.unsavedBanner")}</span>
        </div>
      )}

      {/* Visual timeline */}
      <TariffTimeline slots={slots} />

      {/* Time slots */}
      <div className="mb-5 bg-background rounded-md p-4">
        <h4 className="text-small font-medium text-text mb-3">{t("tariff.timeSlots")}</h4>

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
                className="px-2 py-1 border border-border rounded-sm text-small text-text bg-background"
              />
              <span className="text-text-tertiary text-caption">→</span>
              <input
                type="time"
                step="60"
                value={slot.end}
                onChange={(e) => updateSlot(slotIdx, { end: e.target.value })}
                className="px-2 py-1 border border-border rounded-sm text-small text-text bg-background"
              />
              <select
                value={slot.tariff}
                onChange={(e) => updateSlot(slotIdx, { tariff: e.target.value as "hp" | "hc" })}
                className="px-2 py-1 border border-border rounded-sm text-small text-text bg-background"
              >
                <option value="hp">{t("energy.peakHours")}</option>
                <option value="hc">{t("energy.offPeakHours")}</option>
              </select>
              {slots.length > 1 && (
                <button
                  onClick={() => removeSlot(slotIdx)}
                  className="p-1 text-text-tertiary hover:text-error transition-colors"
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
          className="mt-2 flex items-center gap-1 text-caption text-primary hover:text-primary-hover transition-colors"
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
          className="px-4 py-1.5 bg-primary-fill text-white text-small font-medium rounded-sm hover:bg-primary-fill-hover disabled:opacity-50 transition-colors"
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
        {saved && <span className="text-caption text-success">{t("tariff.saved")}</span>}
        {error && <span className="text-caption text-error">{error}</span>}
      </div>
    </div>
  );
}
