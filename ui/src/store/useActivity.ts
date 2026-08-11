import { create } from "zustand";
import type { ActivityItem, ActivityMessage } from "../types";
import { getActivity } from "../api";
import { loadWithRetry } from "../lib/load-with-retry";

const CAPACITY = 100;
const COALESCE_WINDOW_MS = 500;
const PREF_KEY = "sowel_activity_include_descendants";

type Status = "idle" | "loading" | "ready" | "error";

function loadPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === "true";
  } catch {
    return false;
  }
}

function savePref(v: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, String(v));
  } catch {
    // ignore
  }
}

interface ActivityState {
  items: ActivityItem[];
  status: Status;
  zoneId: string | null;
  /** Zone IDs whose items are accepted (current zone + descendants if toggle ON). Global items (zoneId=null) always accepted. */
  scopeZoneIds: Set<string>;
  includeDescendants: boolean;
  /** Descendants of the zone currently displayed — kept so retry() can re-issue the same load. */
  descendantIds: string[];
  loadForZone: (zoneId: string, descendantIds: string[]) => Promise<void>;
  setIncludeDescendants: (v: boolean, descendantIds: string[]) => Promise<void>;
  retry: () => Promise<void>;
  addItem: (item: ActivityItem) => void;
  reset: () => void;
}

/**
 * Monotonic load counter. A load only writes to the store if it is still the latest one —
 * without it, a slow request that fails (rate limit, token refresh turbulence, sleeping tab)
 * can flip a newer, successful load into the error state.
 */
let loadSeq = 0;

const RETRY_DELAYS_MS = [700, 2500];

export const useActivity = create<ActivityState>((set, get) => ({
  items: [],
  status: "idle",
  zoneId: null,
  scopeZoneIds: new Set(),
  includeDescendants: loadPref(),
  descendantIds: [],

  loadForZone: async (zoneId: string, descendantIds: string[]) => {
    const includeDescendants = get().includeDescendants;
    const scope = new Set<string>([zoneId]);
    if (includeDescendants) for (const id of descendantIds) scope.add(id);
    const seq = ++loadSeq;
    set({ status: "loading", zoneId, items: [], scopeZoneIds: scope, descendantIds });

    // A single blip used to leave the panel stuck on "Impossible de charger l'activité"
    // until the user navigated away and back — retry a couple of times before giving up.
    const outcome = await loadWithRetry(
      () => getActivity(zoneId, { includeDescendants, limit: CAPACITY }),
      { retryDelaysMs: RETRY_DELAYS_MS, isCurrent: () => seq === loadSeq },
    );

    if (outcome.status === "ok") {
      set({ items: outcome.value.items.slice(0, CAPACITY), status: "ready" });
    } else if (outcome.status === "failed") {
      console.error("Failed to load activity", outcome.error);
      set({ status: "error" });
    }
  },

  setIncludeDescendants: async (v: boolean, descendantIds: string[]) => {
    savePref(v);
    set({ includeDescendants: v });
    const { zoneId } = get();
    if (zoneId) await get().loadForZone(zoneId, descendantIds);
  },

  retry: async () => {
    const { zoneId, descendantIds } = get();
    if (!zoneId) return;
    await get().loadForZone(zoneId, descendantIds);
  },

  addItem: (item: ActivityItem) => {
    const state = get();
    // Live items pushed by the WS are broadcast to all subscribers — we filter
    // client-side to keep only items relevant to the current zone scope.
    // Global items (zoneId=null) are always kept; otherwise the item's zone
    // must be in the active scope.
    if (item.zoneId !== null && !state.scopeZoneIds.has(item.zoneId)) return;

    const items = state.items;
    const merged = coalesce(items[0], item);
    if (merged) {
      set({ items: [merged, ...items.slice(1)].slice(0, CAPACITY) });
    } else {
      set({ items: [item, ...items].slice(0, CAPACITY) });
    }
  },

  reset: () => {
    loadSeq++; // drop any in-flight load
    set({ items: [], status: "idle", zoneId: null, scopeZoneIds: new Set(), descendantIds: [] });
  },
}));

/**
 * Attempt to coalesce a new item into the previous one.
 * Returns the merged item, or null when no coalescing applies.
 *
 * Rules:
 * - Both items are category="order"
 * - Same source (deep equal on the source object)
 * - Same alias and same formatted value
 * - The new item's timestamp is within COALESCE_WINDOW_MS of the previous one
 */
export function coalesce(prev: ActivityItem | undefined, next: ActivityItem): ActivityItem | null {
  if (!prev) return null;
  if (next.category !== "order" || prev.category !== "order") return null;
  if (next.timestamp - prev.timestamp > COALESCE_WINDOW_MS) return null;
  if (JSON.stringify(prev.source ?? null) !== JSON.stringify(next.source ?? null)) return null;

  const prevMsg = prev.message;
  const nextMsg = next.message;
  if (nextMsg.template !== "order.executed") return null;

  if (prevMsg.template === "order.executed") {
    if (prevMsg.params.alias !== nextMsg.params.alias) return null;
    if (prevMsg.params.value !== nextMsg.params.value) return null;
    const merged: ActivityItem = {
      ...prev,
      timestamp: next.timestamp,
      message: {
        template: "order.executed.multi",
        params: {
          equipmentNames: [prevMsg.params.equipmentName, nextMsg.params.equipmentName],
          count: 2,
          alias: nextMsg.params.alias,
          value: nextMsg.params.value,
        },
      },
    };
    return merged;
  }
  if (prevMsg.template === "order.executed.multi") {
    if (prevMsg.params.alias !== nextMsg.params.alias) return null;
    if (prevMsg.params.value !== nextMsg.params.value) return null;
    const merged: ActivityItem = {
      ...prev,
      timestamp: next.timestamp,
      message: {
        template: "order.executed.multi",
        params: {
          equipmentNames: [...prevMsg.params.equipmentNames, nextMsg.params.equipmentName],
          count: prevMsg.params.count + 1,
          alias: nextMsg.params.alias,
          value: nextMsg.params.value,
        },
      } as ActivityMessage,
    };
    return merged;
  }

  return null;
}
