// Spec 124 — Lightweight Zustand slice that mirrors GET /api/v1/system/mode.
// Used by the ShadowBanner mounted in AppShell.

import { create } from "zustand";
import { getSystemMode } from "../api";

interface ShadowState {
  shadowMode: boolean;
  /** Fetch the flag once on app mount. Network errors leave the
   * banner hidden — preferable to a spurious banner on a normal
   * instance during a flaky boot. */
  fetch: () => Promise<void>;
}

export const useShadowMode = create<ShadowState>((set) => ({
  shadowMode: false,
  fetch: async () => {
    try {
      const { shadowMode } = await getSystemMode();
      set({ shadowMode });
    } catch {
      // Intentional: stay silent on errors.
    }
  },
}));
