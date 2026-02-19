import { create } from "zustand";
import type { Zone, ZoneWithChildren, EquipmentGroup } from "../types";
import {
  getZones,
  createZone as apiCreateZone,
  updateZone as apiUpdateZone,
  deleteZone as apiDeleteZone,
  createGroup as apiCreateGroup,
  updateGroup as apiUpdateGroup,
  deleteGroup as apiDeleteGroup,
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
  createGroup: (zoneId: string, data: { name: string; icon?: string; description?: string }) => Promise<EquipmentGroup>;
  updateGroup: (id: string, updates: { name?: string; icon?: string | null; description?: string | null }) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;

  // WebSocket handlers
  handleZoneCreated: (zone: Zone) => void;
  handleZoneUpdated: (zone: Zone) => void;
  handleZoneRemoved: (zoneId: string) => void;
  handleGroupCreated: (group: EquipmentGroup) => void;
  handleGroupUpdated: (group: EquipmentGroup) => void;
  handleGroupRemoved: (groupId: string) => void;
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

  createGroup: async (zoneId, data) => {
    const group = await apiCreateGroup(zoneId, data);
    await get().fetchZones();
    return group;
  },

  updateGroup: async (id, updates) => {
    await apiUpdateGroup(id, updates);
    await get().fetchZones();
  },

  deleteGroup: async (id) => {
    await apiDeleteGroup(id);
    await get().fetchZones();
  },

  // WebSocket handlers — refetch tree on any change
  handleZoneCreated: () => { get().fetchZones(); },
  handleZoneUpdated: () => { get().fetchZones(); },
  handleZoneRemoved: () => { get().fetchZones(); },
  handleGroupCreated: () => { get().fetchZones(); },
  handleGroupUpdated: () => { get().fetchZones(); },
  handleGroupRemoved: () => { get().fetchZones(); },
}));
