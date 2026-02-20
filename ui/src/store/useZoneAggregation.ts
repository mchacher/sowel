import { create } from "zustand";
import type { ZoneAggregatedData } from "../types";
import { getZoneAggregation } from "../api";

interface ZoneAggregationState {
  data: Record<string, ZoneAggregatedData>;
  loading: boolean;

  fetchAggregation: () => Promise<void>;
  handleZoneDataChanged: (zoneId: string, aggregatedData: ZoneAggregatedData) => void;
}

export const useZoneAggregation = create<ZoneAggregationState>((set) => ({
  data: {},
  loading: false,

  fetchAggregation: async () => {
    set({ loading: true });
    try {
      const data = await getZoneAggregation();
      set({ data, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  handleZoneDataChanged: (zoneId, aggregatedData) => {
    set((state) => ({
      data: { ...state.data, [zoneId]: aggregatedData },
    }));
  },
}));
