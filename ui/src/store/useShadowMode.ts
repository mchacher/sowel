// Spec 124 — Lightweight Zustand slice that mirrors GET /api/v1/system/mode.
// Used by the ShadowBanner mounted in AppShell.

import { create } from "zustand";
import { getSystemMode } from "../api";

interface ShadowState {
  shadowMode: boolean;
  /** Issue #401 — database restored from another deployment, engine inert. */
  takeoverPending: boolean;
  /** Fetch the flags once on app mount. Network errors leave the
   * banners hidden — preferable to a spurious banner on a normal
   * instance during a flaky boot. */
  fetch: () => Promise<void>;
}

export const useShadowMode = create<ShadowState>((set) => ({
  shadowMode: false,
  takeoverPending: false,
  fetch: async () => {
    try {
      const { shadowMode, takeoverPending } = await getSystemMode();
      set({ shadowMode, takeoverPending: takeoverPending ?? false });
    } catch {
      // Intentional: stay silent on errors.
    }
  },
}));
