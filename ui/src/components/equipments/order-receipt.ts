import { createContext } from "react";
import { useOrderReceipts } from "../../store/useOrderReceipts";

/**
 * Spec 188 — the equipment a dashboard tile belongs to. `EquipmentWidget`
 * provides it, so the shared `WidgetCard` shell can draw the order receipt
 * line for every tile type without each per-type widget wiring it in.
 */
export const TileEquipmentContext = createContext<string | null>(null);

/** The receipt of the equipment's last order, when its device answered. */
export function useOrderReceipt(equipmentId: string | null) {
  return useOrderReceipts((s) => (equipmentId ? s.byEquipment[equipmentId] : undefined));
}
