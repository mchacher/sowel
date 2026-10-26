import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { Check, CircleAlert, Loader2 } from "lucide-react";
import { TileEquipmentContext, useOrderReceipt } from "./order-receipt";
import type { OrderReceiptStatus } from "../../types";

// Spec 188 R4 — one line saying what became of the equipment's last order,
// for equipments whose device answers. Nothing at all otherwise.

const TONE: Record<OrderReceiptStatus, string> = {
  pending: "text-text-tertiary",
  received: "text-text-tertiary",
  delivered: "text-success",
  refused: "text-error",
  not_received: "text-warning",
  unconfirmed: "text-warning",
};

export function OrderReceiptLine({
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
  const receipt = useOrderReceipt(equipmentId);
  if (!receipt) return null;
  const { status } = receipt;
  const icon = size === "xs" ? 10 : 12;
  const text = size === "xs" ? "text-[10px]" : "text-[11px]";
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center justify-center gap-1 max-w-full ${text} font-medium leading-tight ${TONE[status]} ${className}`}
    >
      {status === "pending" || status === "received" ? (
        <Loader2 size={icon} strokeWidth={1.5} className="shrink-0 motion-safe:animate-spin" />
      ) : status === "delivered" ? (
        <Check size={icon} strokeWidth={2} className="shrink-0" />
      ) : (
        <CircleAlert size={icon} strokeWidth={1.5} className="shrink-0" />
      )}
      <span className="truncate">{t(`orderReceipt.${status}`)}</span>
    </span>
  );
}

/** The line inside a tile, read from the tile's own equipment. */
export function TileOrderReceiptLine() {
  const equipmentId = useContext(TileEquipmentContext);
  return <OrderReceiptLine equipmentId={equipmentId} className="w-full" />;
}
