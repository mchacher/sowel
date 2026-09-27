import { create } from "zustand";
import type { SharedAccessState } from "../types";
import { getSettings, getSharedAccessState } from "../api";

export const SHARED_ACCESS_SETTING = "sharedAccess.enabled";

/** A /state answer is trusted only when it is the JSON state saying it is on. */
function isOnState(value: unknown): value is SharedAccessState {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { enabled?: unknown }).enabled === true &&
    Array.isArray((value as { accesses?: unknown }).accesses)
  );
}

/**
 * Spec 181 — the owner's read model of shared access.
 *
 * Whether the feature is on is read from the setting (`sharedAccess.enabled`,
 * admin-readable), NOT from a 404 on the state route: in production the
 * server's not-found handler serves the SPA's index.html to an authenticated
 * unknown path, so "off" comes back as a 200 page. As a second guard, a /state
 * answer that is not the JSON state with `enabled: true` counts as off.
 *
 * `enabled === null` means not known yet (never fetched, not an admin, or every
 * read so far failed), which hides every entry point the same way `false` does.
 * Only a SUCCESSFUL read saying not "true" means off: a failed read (a 429 from
 * the global rate limit, a network error) leaves `enabled` and `state` as they
 * were and sets `error`, so a transient error never hides what was known on.
 *
 * Refreshed on mount of the page, after every write, and — debounced — on the
 * admin-only `shared_access.*` WebSocket events.
 */
interface SharedAccessStore {
  enabled: boolean | null;
  state: SharedAccessState | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshSoon: () => void;
  /** Forget everything (logout, or a non-admin session). */
  reset: () => void;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export const useSharedAccess = create<SharedAccessStore>((set, get) => ({
  enabled: null,
  state: null,
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true });
    let on: boolean;
    try {
      const settings = await getSettings();
      on = settings[SHARED_ACCESS_SETTING] === "true";
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (!on) {
      set({ enabled: false, state: null, loading: false, error: null });
      return;
    }
    try {
      const state: unknown = await getSharedAccessState();
      if (isOnState(state)) {
        set({ state, enabled: true, loading: false, error: null });
      } else {
        set({ enabled: false, state: null, loading: false, error: null });
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        // An HTML page where JSON was expected: the route is not there.
        set({ enabled: false, state: null, loading: false, error: null });
      } else {
        // A transient failure (429, network): unknown, not "off". What was
        // known stays as it was.
        set({ loading: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  },

  refreshSoon: () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void get().refresh();
    }, 300);
  },

  reset: () => set({ enabled: null, state: null, loading: false, error: null }),
}));
