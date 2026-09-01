import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, TimerReset, X } from "lucide-react";
import { WidgetCard } from "./WidgetCard";
import { armTimedCommand, cancelTimedCommand } from "../../api";
import { TimedCountdown } from "../equipments/TimedCountdown";
import { useEquipments } from "../../store/useEquipments";
import type { EquipmentWithDetails } from "../../types";

/**
 * Spec 174 phase 2 (FR-14) — the timed tile.
 *
 * Pinned BESIDE the ordinary tile for the same equipment, never instead of it:
 * the two answer different questions ("open it" and "open it for a quarter of
 * an hour"), and a user who wants both should not have to choose.
 *
 * The configured duration is printed in the sublabel so a press is never a
 * surprise, and the countdown is the shared `TimedCountdown` — the whole reason
 * phase 1 refused to write any UI was five copies of it.
 */
export function TimedEquipmentWidget({
  label,
  sublabel,
  equipment,
  editMode,
}: {
  label: string;
  sublabel?: string;
  equipment: EquipmentWithDetails;
  /** Edit mode disables actuation so the tile can be dragged and renamed. */
  editMode?: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const configured = equipment.timedCommand;
  const running = equipment.timedAction;
  const minutes = configured ? Math.round(configured.durationMs / 60_000) : 0;
  // Nothing to arm: the equipment page cleared the configuration under a tile
  // that is still pinned, or the equipment was disabled. The tile says so and
  // does nothing — pressing it must never fall back to actuating outright.
  const inert = !configured || !equipment.enabled;

  const run = async (action: () => Promise<unknown>) => {
    if (busy || editMode || inert) return;
    setBusy(true);
    setError(false);
    try {
      await action();
      // The engine also broadcasts the window, but the person who just pressed
      // should not wait a batch to see it.
      await useEquipments.getState().fetchEquipments();
    } catch {
      // The row stays as it is and the tile says so: a control that silently
      // does nothing is worse than one that admits the order did not go out.
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  // A second press extends the window (FR-5, nothing dispatched), which is what
  // somebody standing in front of an open gate means by pressing again.
  const arm = () => run(() => armTimedCommand(equipment.id));
  const cancel = () => run(() => cancelTimedCommand(equipment.id, true));

  return (
    <WidgetCard
      label={label}
      sublabel={
        sublabel ?? (configured ? t("dashboard.timed.sublabel", { count: minutes }) : undefined)
      }
      onClick={!running && !editMode && !inert ? arm : undefined}
    >
      <div className="flex-1 flex items-center justify-center">
        {busy ? (
          <Loader2 size={32} className="animate-spin text-text-tertiary" />
        ) : (
          <TimerReset size={40} strokeWidth={1.5} className="text-text-tertiary" />
        )}
      </div>

      <div className="flex justify-center mt-auto pt-1">
        {running ? (
          <span className="text-[12px] font-medium px-2.5 py-0.5 rounded-full bg-active/10 text-active-text">
            <TimedCountdown action={running} />
          </span>
        ) : (
          <span className="text-[12px] font-medium px-2.5 py-0.5 rounded-full bg-border-light text-text-tertiary">
            {inert
              ? t("dashboard.timed.unavailable")
              : error
                ? t("dashboard.timed.failed")
                : t("dashboard.timed.idle", { count: minutes })}
          </span>
        )}
      </div>

      <div className="flex justify-center gap-3 mt-auto pt-1">
        <button
          onClick={arm}
          disabled={busy || editMode || inert}
          title={running ? t("dashboard.timed.extend") : t("dashboard.timed.arm", { count: minutes })}
          className={`w-10 h-10 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed ${
            running ? "!border-active/40 !text-active !bg-active/5" : ""
          }`}
        >
          <TimerReset size={16} strokeWidth={1.5} />
        </button>
        {running && (
          <button
            onClick={cancel}
            disabled={busy || editMode}
            title={t("dashboard.timed.cancel")}
            className="w-10 h-10 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        )}
      </div>
    </WidgetCard>
  );
}
