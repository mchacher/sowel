import { create } from "zustand";
import type { ZoneAggregatedData } from "../types";
import { getZoneAggregation } from "../api";
import { apiErrorText } from "../lib/api-error";

interface ZoneAggregationState {
  data: Record<string, ZoneAggregatedData>;
  loading: boolean;
  error: string | null;

  fetchAggregation: () => Promise<void>;
  handleZoneDataChanged: (zoneId: string, aggregatedData: ZoneAggregatedData) => void;
}

export const useZoneAggregation = create<ZoneAggregationState>((set) => ({
  data: {},
  loading: false,
  error: null,

  fetchAggregation: async () => {
    set({ loading: true, error: null });
    try {
      const data = await getZoneAggregation();
      set({ data, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: apiErrorText(err),
      });
    }
  },

  handleZoneDataChanged: (zoneId, aggregatedData) => {
    set((state) => ({
      data: { ...state.data, [zoneId]: aggregatedData },
    }));
  },
}));
