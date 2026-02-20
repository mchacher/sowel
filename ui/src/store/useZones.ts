import { create } from "zustand";
import type { Zone, ZoneWithChildren } from "../types";
import {
  getZones,
  createZone as apiCreateZone,
  updateZone as apiUpdateZone,
  deleteZone as apiDeleteZone,
} from "../api";

interface ZonesState {
  tree: ZoneWithChildren[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchZones: () => Promise<void>;
  createZone: (data: { name: string; parentId?: string | null; icon?: string; description?: string }) => Promise<Zone>;
  updateZone: (id: string, updates: { name?: string; parentId?: string | null; icon?: string | null; description?: string | null }) => Promise<void>;
  deleteZone: (id: string) => Promise<void>;

  // WebSocket handlers
  handleZoneCreated: (zone: Zone) => void;
  handleZoneUpdated: (zone: Zone) => void;
  handleZoneRemoved: (zoneId: string) => void;
}

export const useZones = create<ZonesState>((set, get) => ({
  tree: [],
  loading: false,
  error: null,

  fetchZones: async () => {
    set({ loading: true, error: null });
    try {
      const tree = await getZones();
      set({ tree, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch zones",
      });
    }
  },

  createZone: async (data) => {
    const zone = await apiCreateZone(data);
    // Refetch tree to get correct structure
    await get().fetchZones();
    return zone;
  },

  updateZone: async (id, updates) => {
    await apiUpdateZone(id, updates);
    await get().fetchZones();
  },

  deleteZone: async (id) => {
    await apiDeleteZone(id);
    await get().fetchZones();
  },

  // WebSocket handlers — refetch tree on any change
  handleZoneCreated: () => { get().fetchZones(); },
  handleZoneUpdated: () => { get().fetchZones(); },
  handleZoneRemoved: () => { get().fetchZones(); },
}));
