import { create } from "zustand";
import type { SavedChart, SavedChartConfig } from "../types";
import {
  getCharts,
  createChart as apiCreate,
  updateChart as apiUpdate,
  deleteChart as apiDelete,
} from "../api";

interface ChartsState {
  charts: SavedChart[];
  loading: boolean;
  error: string | null;
  fetchCharts: () => Promise<void>;
  createChart: (name: string, config: SavedChartConfig) => Promise<SavedChart>;
  updateChart: (id: string, data: { name?: string; config?: SavedChartConfig }) => Promise<SavedChart>;
  deleteChart: (id: string) => Promise<void>;
}

export const useCharts = create<ChartsState>((set, get) => ({
  charts: [],
  loading: false,
  error: null,

  fetchCharts: async () => {
    set({ loading: true, error: null });
    try {
      const charts = await getCharts();
      set({ charts, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch charts",
      });
    }
  },

  createChart: async (name, config) => {
    const chart = await apiCreate({ name, config });
    await get().fetchCharts();
    return chart;
  },

  updateChart: async (id, data) => {
    const chart = await apiUpdate(id, data);
    await get().fetchCharts();
    return chart;
  },

  deleteChart: async (id) => {
    await apiDelete(id);
    await get().fetchCharts();
  },
}));
