import { create } from "zustand";
import type { ModeWithDetails } from "../types";
import {
  getModes,
  activateMode as apiActivate,
  deactivateMode as apiDeactivate,
  createMode as apiCreate,
  updateMode as apiUpdate,
  deleteMode as apiDelete,
} from "../api";
import { apiErrorText } from "../lib/api-error";

interface ModesState {
  modes: ModeWithDetails[];
  loading: boolean;
  error: string | null;
  fetchModes: () => Promise<void>;
  createMode: (data: {
    name: string;
    icon?: string;
    description?: string;
  }) => Promise<ModeWithDetails>;
  updateMode: (
    id: string,
    data: { name?: string; icon?: string; description?: string },
  ) => Promise<void>;
  deleteMode: (id: string) => Promise<void>;
  activateMode: (id: string) => Promise<void>;
  deactivateMode: (id: string) => Promise<void>;
  handleModeEvent: () => void;
  handleModeActivated: (modeId: string) => void;
  handleModeDeactivated: (modeId: string) => void;
}

export const useModes = create<ModesState>((set, get) => ({
  modes: [],
  loading: false,
  error: null,

  fetchModes: async () => {
    set({ loading: true, error: null });
    try {
      const modes = await getModes();
      set({ modes, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: apiErrorText(err),
      });
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

  handleModeEvent: () => {
    get().fetchModes();
  },

  handleModeActivated: (modeId) => {
    set((state) => ({
      modes: state.modes.map((m) => (m.id === modeId ? { ...m, active: true } : m)),
    }));
  },

  handleModeDeactivated: (modeId) => {
    set((state) => ({
      modes: state.modes.map((m) => (m.id === modeId ? { ...m, active: false } : m)),
    }));
  },
}));
