import { create } from "zustand";

interface PendingOrder {
  equipmentId: string;
  alias: string;
  startedAt: number; // performance.now()
}

interface OrderTimingEntry {
  equipmentId: string;
  alias: string;
  roundTripMs: number;
  timestamp: string;
}

interface OrderTimingState {
  /** Currently pending orders awaiting confirmation */
  pending: PendingOrder[];
  /** Completed round-trip measurements (last 50) */
  history: OrderTimingEntry[];

  /** Call before sending an order */
  markSent: (equipmentId: string, alias: string) => void;
  /** Call when a data.changed event arrives — resolves matching pending order */
  markReceived: (equipmentId: string, alias: string) => void;
  /** Clear history */
  clear: () => void;
}

const MAX_HISTORY = 50;

export const useOrderTiming = create<OrderTimingState>((set, get) => ({
  pending: [],
  history: [],

  markSent: (equipmentId, alias) => {
    set((s) => ({
      pending: [
        ...s.pending,
        { equipmentId, alias, startedAt: performance.now() },
      ],
    }));
  },

  markReceived: (equipmentId, alias) => {
    const { pending } = get();
    // Find the oldest matching pending order
    const idx = pending.findIndex(
      (p) => p.equipmentId === equipmentId && p.alias === alias,
    );
    if (idx === -1) return;

    const order = pending[idx];
    const roundTripMs = Math.round(performance.now() - order.startedAt);
    const entry: OrderTimingEntry = {
      equipmentId,
      alias,
      roundTripMs,
      timestamp: new Date().toISOString(),
    };

    console.log(
      `%c[perf] ${alias} round-trip: ${roundTripMs}ms`,
      "color: #FACC15; font-weight: bold",
      { equipmentId, alias, roundTripMs },
    );

    set((s) => ({
      pending: s.pending.filter((_, i) => i !== idx),
      history: [...s.history, entry].slice(-MAX_HISTORY),
    }));
  },

  clear: () => set({ pending: [], history: [] }),
}));
