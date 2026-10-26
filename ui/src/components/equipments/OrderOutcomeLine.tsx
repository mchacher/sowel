import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { Check, CircleAlert, Loader2 } from "lucide-react";
import { TileEquipmentContext, outcomeText, useOrderOutcome } from "./order-outcome";
import type { OrderOutcomeStatus } from "../../types";

// Spec 188 O5 — one line saying what became of the equipment's last tracked
// order (a gate impulse, a cover OPEN / CLOSE), read from the state the device
// reported. Nothing at all for an order the engine does not track.

const TONE: Record<OrderOutcomeStatus, string> = {
  pending: "text-text-tertiary",
  moving: "text-text-tertiary",
  confirmed: "text-success",
  fault: "text-error",
  unconfirmed: "text-warning",
};

export function OrderOutcomeLine({
  equipmentId,
  size = "sm",
  className = "",
}: {
  equipmentId: string | null;
  /** `xs` on the phone's half-width card, `sm` on the tile and the detail page. */
  size?: "xs" | "sm";
  className?: string;
}) {
  const { t } = useTranslation();
  const outcome = useOrderOutcome(equipmentId);
  if (!outcome) return null;
  const { status } = outcome;
  const icon = size === "xs" ? 10 : 12;
  const text = size === "xs" ? "text-[10px]" : "text-[11px]";
  const label = outcomeText(t, outcome);
  return (
    <span
      role="status"
      aria-live="polite"
      title={label}
      className={`inline-flex items-center justify-center gap-1 max-w-full ${text} font-medium leading-tight ${TONE[status]} ${className}`}
    >
      {status === "pending" || status === "moving" ? (
        <Loader2 size={icon} strokeWidth={1.5} className="shrink-0 motion-safe:animate-spin" />
      ) : status === "confirmed" ? (
        <Check size={icon} strokeWidth={2} className="shrink-0" />
      ) : (
        <CircleAlert size={icon} strokeWidth={1.5} className="shrink-0" />
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}

/** The line inside a tile, read from the tile's own equipment. */
export function TileOrderOutcomeLine() {
  const equipmentId = useContext(TileEquipmentContext);
  return <OrderOutcomeLine equipmentId={equipmentId} className="w-full" />;
}
