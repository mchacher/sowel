import { create } from "zustand";
import type { OrderOutcomeExpected, OrderOutcomeStatus } from "../types";

// ============================================================
// Spec 188 O5 — the outcome of each equipment's last tracked order.
//
// Live state only: it is fed by `equipment.order.outcome` over the WebSocket
// and is not reloaded from anywhere, so a page reload shows nothing until the
// next order. An order the engine does not track (a light, a cover that never
// spoke the end-state vocabulary, a gate whose state is unknown) never gets an
// entry.
// ============================================================

/** How long « ✓ Opening confirmed » stays before the line goes away. */
export const CONFIRMED_SHOWN_MS = 4000;
/**
 * A spinner with no final status this long after the order is dropped: the
 * engine's longest window is 60 s, so a client still spinning past 70 s missed
 * the final event (socket hiccup) and would otherwise spin for ever.
 */
export const IN_FLIGHT_SHOWN_MS = 70_000;

export interface OrderOutcomeEntry {
  alias: string;
  status: OrderOutcomeStatus;
  expected?: OrderOutcomeExpected;
  detail?: string;
  /**
   * A gate impulse (the only tracked order whose value is `pulse`): its
   * unconfirmed line says what the gate state could not tell (O2).
   */
  gate: boolean;
  /** Bumped on every outcome, so a stale clear timer leaves a newer one alone. */
  seq: number;
  /** The `seq` of the order this line belongs to (its `pending`), for the spinner bound. */
  orderSeq: number;
}

export interface OrderOutcomeInput {
  equipmentId: string;
  orderAlias: string;
  value: unknown;
  status: OrderOutcomeStatus;
  expected?: OrderOutcomeExpected;
  detail?: string;
}

interface OrderOutcomesState {
  byEquipment: Record<string, OrderOutcomeEntry>;
  handleOutcome: (event: OrderOutcomeInput) => void;
  /** A new order on the equipment: a final line from the previous one goes. */
  handleOrderExecuted: (equipmentId: string, orderAlias: string) => void;
  clear: (equipmentId: string, seq: number) => void;
  /** Drop the line of an order still spinning (by its `orderSeq`). */
  clearInFlight: (equipmentId: string, orderSeq: number) => void;
  /** Drop every spinner — on a WebSocket reconnect, a final status may have been missed. */
  expireInFlight: () => void;
}

const inFlight = (s: OrderOutcomeStatus) => s === "pending" || s === "moving";

let seq = 0;

export const useOrderOutcomes = create<OrderOutcomesState>((set, get) => ({
  byEquipment: {},

  handleOutcome: ({ equipmentId, orderAlias, value, status, expected, detail }) => {
    const mine = ++seq;
    const previous = get().byEquipment[equipmentId];
    const startsOrder = status === "pending" || !previous;
    const orderSeq = startsOrder ? mine : previous.orderSeq;
    set((s) => ({
      byEquipment: {
        ...s.byEquipment,
        [equipmentId]: {
          alias: orderAlias,
          status,
          ...(expected ? { expected } : {}),
          ...(detail ? { detail } : {}),
          gate: typeof value === "string" && value.trim().toLowerCase() === "pulse",
          seq: mine,
          orderSeq,
        },
      },
    }));
    // A fault or an unconfirmed stays until the next order; a confirmation
    // fades out; a spinner is bounded from the order it belongs to.
    if (status === "confirmed") {
      setTimeout(() => get().clear(equipmentId, mine), CONFIRMED_SHOWN_MS);
    } else if (startsOrder && inFlight(status)) {
      setTimeout(() => get().clearInFlight(equipmentId, orderSeq), IN_FLIGHT_SHOWN_MS);
    }
  },

  handleOrderExecuted: (equipmentId, orderAlias) => {
    const current = get().byEquipment[equipmentId];
    // A spinner already belongs to the new order (its outcome may arrive
    // before or after this event); only a final line is from the last one.
    if (!current || current.alias !== orderAlias || inFlight(current.status)) return;
    get().clear(equipmentId, current.seq);
  },

  expireInFlight: () => {
    set((s) => {
      const next: Record<string, OrderOutcomeEntry> = {};
      for (const [id, entry] of Object.entries(s.byEquipment)) {
        if (!inFlight(entry.status)) next[id] = entry;
      }
      return { byEquipment: next };
    });
  },

  clearInFlight: (equipmentId, orderSeq) => {
    const current = get().byEquipment[equipmentId];
    if (!current || current.orderSeq !== orderSeq || !inFlight(current.status)) return;
    get().clear(equipmentId, current.seq);
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
