import { create } from "zustand";
import type { OrderReceiptStatus } from "../types";

// ============================================================
// Spec 188 R4 — the receipt of each equipment's last order.
//
// Live state only: it is fed by `equipment.order.receipt` over the WebSocket
// and is not reloaded from anywhere, so a page reload shows nothing until the
// next order. An equipment whose device never answers never gets an entry.
// ============================================================

/** How long « ✓ Confirmed » stays before the line goes away. */
export const DELIVERED_SHOWN_MS = 4000;
/**
 * A spinner with no final status this long is dropped: the engine turns such
 * an order into `unconfirmed` at 60 s, so a client still spinning past it
 * missed that event (socket hiccup) and would otherwise spin for ever.
 */
export const IN_FLIGHT_SHOWN_MS = 60_000;

export interface OrderReceiptEntry {
  alias: string;
  status: OrderReceiptStatus;
  late: boolean;
  /** Bumped on every receipt, so a stale clear timer leaves a newer one alone. */
  seq: number;
}

interface OrderReceiptsState {
  byEquipment: Record<string, OrderReceiptEntry>;
  handleReceipt: (
    equipmentId: string,
    alias: string,
    status: OrderReceiptStatus,
    late?: boolean,
  ) => void;
  clear: (equipmentId: string, seq: number) => void;
  /** Drop every spinner — on a WebSocket reconnect, a final status may have been missed. */
  expireInFlight: () => void;
}

let seq = 0;

export const useOrderReceipts = create<OrderReceiptsState>((set, get) => ({
  byEquipment: {},

  handleReceipt: (equipmentId, alias, status, late) => {
    const mine = ++seq;
    set((s) => ({
      byEquipment: {
        ...s.byEquipment,
        [equipmentId]: { alias, status, late: late === true, seq: mine },
      },
    }));
    // Failures stay until the next order; only a confirmation fades out.
    if (status === "delivered") {
      setTimeout(() => get().clear(equipmentId, mine), DELIVERED_SHOWN_MS);
    } else if (status === "pending" || status === "received") {
      setTimeout(() => get().clear(equipmentId, mine), IN_FLIGHT_SHOWN_MS);
    }
  },

  expireInFlight: () => {
    set((s) => {
      const next: Record<string, OrderReceiptEntry> = {};
      for (const [id, entry] of Object.entries(s.byEquipment)) {
        if (entry.status !== "pending" && entry.status !== "received") next[id] = entry;
      }
      return { byEquipment: next };
    });
  },

  clear: (equipmentId, at) => {
    const current = get().byEquipment[equipmentId];
    if (!current || current.seq !== at) return;
    set((s) => {
      const next = { ...s.byEquipment };
      delete next[equipmentId];
      return { byEquipment: next };
    });
  },
}));
