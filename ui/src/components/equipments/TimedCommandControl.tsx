import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, TimerReset, X } from "lucide-react";
import { armTimedCommand, cancelTimedCommand } from "../../api";
import { useEquipments } from "../../store/useEquipments";
import { TimedCountdown } from "./TimedCountdown";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import type { EquipmentWithDetails } from "../../types";

/**
 * Spec 174 phase 2 (FR-14/FR-15) — the timed control on a dense row.
 *
 * The compact card's half of the feature. It renders nothing at all when the
 * equipment offers no timed command, so the row keeps its current shape for
 * every equipment but the few that were configured.
 *
 * While a window is open the badge carries the shared `TimedCountdown` and the
 * button becomes a cancel: pressing the timed control again would extend the
 * window, and somebody looking at an open gate on this row wants to close it,
 * not to keep it open longer. The extend gesture lives on the tile, which is
 * where a press is deliberate enough to mean "more time".
 */
export function TimedCommandControl({
  equipment,
  labelled,
}: {
  equipment: EquipmentWithDetails;
  /**
   * Show the words as well as the icon. The equipment page has room for them,
   * and there the timed command sits beside the ordinary one: two icon-only
   * buttons side by side is a guessing game about which does what.
   */
  labelled?: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  // Spec 196 — arming actuates the gate now, so a guarded gate asks first.
  // Cancelling does not ask: it ends a window somebody already confirmed.
  const { guardGate, element: confirmElement } = useGuardedAction();

  if (!equipment.timedCommand || !equipment.enabled) return null;
  const running = equipment.timedAction;
  const minutes = Math.round(equipment.timedCommand.durationMs / 60_000);

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await useEquipments.getState().fetchEquipments();
    } catch {
      // Swallowed on purpose: the row has no space for an error line, and the
      // refetch below leaves it showing what the engine actually holds.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {running && (
        <span className="text-micro font-medium px-2 py-0.5 rounded-full bg-active-bg text-active-ink flex-shrink-0">
          <TimedCountdown action={running} size={14} />
        </span>
      )}
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (running) {
            void run(() => cancelTimedCommand(equipment.id, true));
            return;
          }
          const value = equipment.timedCommand?.value;
          guardGate(
            equipment,
            typeof value === "string" ? value : null,
            () => void run(() => armTimedCommand(equipment.id)),
          );
        }}
        disabled={busy}
        title={running ? t("dashboard.timed.cancel") : t("dashboard.timed.arm", { count: minutes })}
        className={`rounded-sm transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5 ${
          labelled ? "px-3 py-2 text-small font-medium" : "p-2"
        } ${
          running
            ? "bg-active-bg text-active-ink hover:bg-active/20"
            : "bg-primary/10 text-primary hover:bg-primary/20"
        }`}
      >
        {busy ? (
          <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
        ) : running ? (
          <X size={16} strokeWidth={1.5} />
        ) : (
          <TimerReset size={16} strokeWidth={1.5} />
        )}
        {labelled && (
          <span>
            {running ? t("dashboard.timed.cancel") : t("dashboard.timed.arm", { count: minutes })}
          </span>
        )}
      </button>
      {confirmElement}
    </div>
  );
}
