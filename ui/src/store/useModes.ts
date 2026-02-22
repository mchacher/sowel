import { create } from "zustand";
import type { ModeWithDetails } from "../types";
import {
  getModes,
  activateMode as apiActivate,
  deactivateMode as apiDeactivate,
  applyModeToZone as apiApplyToZone,
  createMode as apiCreate,
  updateMode as apiUpdate,
  deleteMode as apiDelete,
} from "../api";

interface ModesState {
  modes: ModeWithDetails[];
  loading: boolean;
  fetchModes: () => Promise<void>;
  createMode: (data: { name: string; icon?: string; description?: string }) => Promise<ModeWithDetails>;
  updateMode: (id: string, data: { name?: string; icon?: string; description?: string }) => Promise<void>;
  deleteMode: (id: string) => Promise<void>;
  activateMode: (id: string) => Promise<void>;
  deactivateMode: (id: string) => Promise<void>;
  applyModeToZone: (modeId: string, zoneId: string) => Promise<void>;
  handleModeEvent: () => void;
  handleModeActivated: (modeId: string) => void;
  handleModeDeactivated: (modeId: string) => void;
}

export const useModes = create<ModesState>((set, get) => ({
  modes: [],
  loading: false,

  fetchModes: async () => {
    set({ loading: true });
    try {
      const modes = await getModes();
      set({ modes, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  createMode: async (data) => {
    const mode = await apiCreate(data);
    await get().fetchModes();
    return mode;
  },

  updateMode: async (id, data) => {
    await apiUpdate(id, data);
    await get().fetchModes();
  },

  deleteMode: async (id) => {
    await apiDelete(id);
    await get().fetchModes();
  },

  activateMode: async (id) => {
    await apiActivate(id);
  },

  deactivateMode: async (id) => {
    await apiDeactivate(id);
  },

  applyModeToZone: async (modeId, zoneId) => {
    await apiApplyToZone(modeId, zoneId);
  },

  handleModeEvent: () => {
    get().fetchModes();
  },

  handleModeActivated: (modeId) => {
    set((state) => ({
      modes: state.modes.map((m) =>
        m.id === modeId ? { ...m, active: true } : m
      ),
    }));
  },

  handleModeDeactivated: (modeId) => {
    set((state) => ({
      modes: state.modes.map((m) =>
        m.id === modeId ? { ...m, active: false } : m
      ),
    }));
  },
}));
