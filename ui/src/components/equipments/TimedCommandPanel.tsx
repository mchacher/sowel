import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TimerReset, Loader2 } from "lucide-react";
import { updateEquipment } from "../../api";
import { TimedCountdown } from "./TimedCountdown";
import type { EquipmentWithDetails } from "../../types";

/**
 * Spec 174 phase 2 (FR-12) — configure the timed command an equipment offers.
 *
 * Off by default, in the shape of the "Confirmation before action" panel
 * (spec 146): the same question, asked once, on the equipment rather than on
 * each surface that actuates it. Admin only, and only on an eligible equipment
 * — the caller gates the mount on the second condition.
 *
 * One duration per equipment is the deliberate consequence: no "Gate 15 min"
 * and "Gate 2 h" side by side. Putting the duration in each tile's
 * configuration is what would buy that, and it was weighed and dropped.
 */

/** Offered windows. A gate wants minutes, an outside light sometimes an hour. */
const DURATIONS_MS = [
  60_000,
  5 * 60_000,
  10 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
];

export function TimedCommandPanel({
  equipment,
  onUpdated,
}: {
  equipment: EquipmentWithDetails;
  onUpdated: () => void;
}) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configured = equipment.timedCommand ?? null;
  const enabled = configured !== null;

  // An order is a candidate when it can be armed; the equipment page only
  // mounts this panel when at least one can.
  const orders = equipment.orderBindings;
  const alias = configured?.alias ?? orders[0]?.alias ?? "";
  const enumValues = orders.find((o) => o.alias === alias)?.enumValues ?? [];
  const durationMs = configured?.durationMs ?? 15 * 60_000;

  const save = async (next: typeof configured) => {
    setSaving(true);
    setError(null);
    try {
      await updateEquipment(equipment.id, { timedCommand: next });
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const toggle = (on: boolean) =>
    void save(
      on
        ? {
            alias,
            // An order with no vocabulary carries no value: a sliding gate's
            // sequential impulse is one command that opens, then closes.
            value: enumValues[0] ?? null,
            revertValue: enumValues[1] ?? enumValues[0] ?? null,
            durationMs,
          }
        : null,
    );

  const patch = (field: "alias" | "value" | "revertValue" | "durationMs", raw: string) => {
    if (!configured) return;
    const next = { ...configured };
    if (field === "durationMs") next.durationMs = Number(raw);
    else if (field === "alias") {
      next.alias = raw;
      const vocab = orders.find((o) => o.alias === raw)?.enumValues ?? [];
      next.value = vocab[0] ?? null;
      next.revertValue = vocab[1] ?? vocab[0] ?? null;
    } else next[field] = raw === "" ? null : raw;
    void save(next);
  };

  const selectClass =
    "px-2 py-1 text-[12px] bg-background border border-border rounded-[6px] text-text disabled:opacity-50";

  return (
    <div className="bg-surface rounded-[10px] border border-border mb-6 p-4">
      <div className="flex items-center gap-2 mb-1">
        <TimerReset size={16} strokeWidth={1.5} className="text-text-tertiary" />
        <h3 className="text-[14px] font-semibold text-text">{t("equipments.timed.title")}</h3>
        <label className="ml-auto flex items-center gap-2 text-[12px] text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            disabled={saving}
            onChange={(e) => toggle(e.target.checked)}
          />
          {t("equipments.timed.enable")}
        </label>
      </div>
      <p className="text-[12px] text-text-tertiary flex items-center gap-1.5">
        {t("equipments.timed.hint")}
        {saving && <Loader2 size={12} className="animate-spin text-text-tertiary" />}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-text-tertiary">{t("equipments.timed.command")}</span>
          <select
            className={selectClass}
            value={alias}
            disabled={!enabled || saving}
            onChange={(e) => patch("alias", e.target.value)}
          >
            {orders.map((o) => (
              <option key={o.id} value={o.alias}>
                {o.alias}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-text-tertiary">{t("equipments.timed.revert")}</span>
          <select
            className={selectClass}
            value={String(configured?.revertValue ?? "")}
            disabled={!enabled || saving || enumValues.length === 0}
            onChange={(e) => patch("revertValue", e.target.value)}
          >
            {/* An impulse has no vocabulary: the revert IS the same command, and
                saying so is clearer than an empty control. */}
            {enumValues.length === 0 ? (
              <option value="">{t("equipments.timed.sameCommand")}</option>
            ) : (
              enumValues.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-text-tertiary">{t("equipments.timed.duration")}</span>
          <select
            className={selectClass}
            value={String(durationMs)}
            disabled={!enabled || saving}
            onChange={(e) => patch("durationMs", e.target.value)}
          >
            {DURATIONS_MS.map((ms) => (
              <option key={ms} value={ms}>
                {t("equipments.timed.minutes", { count: Math.round(ms / 60_000) })}
              </option>
            ))}
          </select>
        </label>
      </div>

      {equipment.timedAction && (
        <div className="mt-4 flex items-center gap-2 text-[12px] text-text-secondary bg-active/10 border border-active/30 rounded-[8px] px-3 py-2">
          <span className="text-active-text">
            <TimedCountdown action={equipment.timedAction} />
          </span>
          {t("equipments.timed.running")}
        </div>
      )}

      {error && <p className="text-[12px] text-error mt-2">{error}</p>}
    </div>
  );
}
