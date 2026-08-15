import { create } from "zustand";
import type { ArbiterPublicState, ArbiterRunState } from "../types";
import { getArbiterState } from "../api";

/**
 * Spec 140 — read model of the energy capacity arbiter (FR-10 surface).
 * Refreshed on demand and whenever an `energy.*` WebSocket event lands
 * (debounced: grant/revoke bursts trigger one fetch).
 */
interface ArbiterStore {
  state: ArbiterPublicState | null;
  loading: boolean;
  /**
   * Bumped once per debounced arbiter refresh so live views (the timeline
   * surplus curve + ribbons) can refetch in step with the badge instead of
   * staying frozen on their mount snapshot (issue #514).
   */
  timelineRev: number;
  fetch: () => Promise<void>;
  /** Patch the live number without a round-trip (status events). */
  patchStatus: (runState: ArbiterRunState, availableSurplusW: number | null) => void;
  /** Debounced refetch used by the WS event router. */
  refreshSoon: () => void;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export const useArbiter = create<ArbiterStore>((set, get) => ({
  state: null,
  loading: false,
  timelineRev: 0,

  fetch: async () => {
    set({ loading: true });
    try {
      const state = await getArbiterState();
      set({ state, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  patchStatus: (runState, availableSurplusW) => {
    const current = get().state;
    if (!current) return;
    set({ state: { ...current, state: runState, availableSurplusW } });
  },

  refreshSoon: () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void get().fetch();
      // Signal live timeline views to refetch — once per burst, not per event.
      set((s) => ({ timelineRev: s.timelineRev + 1 }));
    }, 400);
  },
}));
