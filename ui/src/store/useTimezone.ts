import { create } from "zustand";
import { getSystemTimezone } from "../api";

interface TimezoneState {
  tz: string;
  source: "env" | "auto" | "fallback" | "unknown";
  offsetHours: number;
  loaded: boolean;
  fetch: () => Promise<void>;
}

/**
 * Global timezone store.
 *
 * Populated once at app mount (from AppLayout). The backend derives the
 * timezone from home.latitude/home.longitude (or TZ env var) at boot and
 * exposes it via `GET /api/v1/system/timezone`.
 *
 * Used by:
 * - CurrentTimePill (header banner) — to format the home time
 * - SettingsPage → Home — to display the TZ and its source
 */
export const useTimezone = create<TimezoneState>((set) => ({
  tz: "UTC",
  source: "unknown",
  offsetHours: 0,
  loaded: false,
  fetch: async () => {
    try {
      const info = await getSystemTimezone();
      set({
        tz: info.tz,
        source: info.source,
        offsetHours: info.offsetHours,
        loaded: true,
      });
    } catch {
      // User might not be authenticated yet — fall back silently
    }
  },
}));
