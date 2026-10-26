import { createContext } from "react";
import { useOrderOutcomes, type OrderOutcomeEntry } from "../../store/useOrderOutcomes";

/**
 * Spec 188 — the equipment a dashboard tile belongs to. `EquipmentWidget`
 * provides it, so the shared `WidgetCard` shell can draw the order outcome
 * line for every tile type without each per-type widget wiring it in.
 */
export const TileEquipmentContext = createContext<string | null>(null);

/** The outcome of the equipment's last tracked order, when there is one. */
export function useOrderOutcome(equipmentId: string | null) {
  return useOrderOutcomes((s) => (equipmentId ? s.byEquipment[equipmentId] : undefined));
}

/** Fault reasons the UI words; any other is shown as the device sent it. */
const KNOWN_FAULTS = new Set(["BOTTOM", "WIRING"]);

/** The line's text, in the viewer's language. */
export function outcomeText(
  t: (key: string, o?: Record<string, string>) => string,
  e: OrderOutcomeEntry,
): string {
  switch (e.status) {
    case "pending":
      return t("orderOutcome.pending");
    case "moving":
      return t("orderOutcome.moving");
    case "confirmed":
      return t(
        e.expected === "close" ? "orderOutcome.confirmedClose" : "orderOutcome.confirmedOpen",
      );
    case "fault": {
      if (!e.detail) return t("orderOutcome.fault");
      const reason = KNOWN_FAULTS.has(e.detail)
        ? t(`orderOutcome.faultReason.${e.detail.toLowerCase()}`)
        : e.detail;
      return t("orderOutcome.faultWithReason", { reason });
    }
    case "unconfirmed":
      // O2 — a gate says what its state could not tell apart.
      if (e.gate) {
        return t(
          e.expected === "close" ? "orderOutcome.gateStillOpen" : "orderOutcome.gateNoMovement",
        );
      }
      return t("orderOutcome.unconfirmed");
  }
}
