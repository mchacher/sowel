import { create } from "zustand";

/**
 * Spec 191 — live refresh of the charge-session views. The sections fetch
 * their own month; a session event bumps `rev` (debounced: a session updates
 * once per 5-minute window, at an attribution, and when a car report adds
 * evidence — spec 192), and every mounted section refetches.
 */
interface EvSessionsStore {
  rev: number;
  refreshSoon: () => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export const useEvSessions = create<EvSessionsStore>((set) => ({
  rev: 0,
  refreshSoon: () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      set((s) => ({ rev: s.rev + 1 }));
    }, 500);
  },
}));
