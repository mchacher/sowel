import { create } from "zustand";
import type { DashboardWidget, WidgetFamily } from "../types";
import {
  getDashboardWidgets,
  createDashboardWidget as apiCreate,
  updateDashboardWidget as apiUpdate,
  deleteDashboardWidget as apiDelete,
  reorderDashboardWidgets as apiReorder,
} from "../api";

interface DashboardState {
  widgets: DashboardWidget[];
  loading: boolean;
  error: string | null;

  fetchWidgets: () => Promise<void>;
  createWidget: (data: {
    type: "equipment" | "zone";
    equipmentId?: string;
    zoneId?: string;
    family?: WidgetFamily;
    label?: string;
    icon?: string;
  }) => Promise<DashboardWidget>;
  updateWidget: (id: string, data: { label?: string | null; icon?: string | null }) => Promise<void>;
  deleteWidget: (id: string) => Promise<void>;
  reorderWidgets: (order: string[]) => Promise<void>;
  setWidgets: (widgets: DashboardWidget[]) => void;
}

export const useDashboard = create<DashboardState>((set, get) => ({
  widgets: [],
  loading: false,
  error: null,

  fetchWidgets: async () => {
    set({ loading: true, error: null });
    try {
      const widgets = await getDashboardWidgets();
      set({ widgets, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  createWidget: async (data) => {
    const widget = await apiCreate(data);
    set({ widgets: [...get().widgets, widget] });
    return widget;
  },

  updateWidget: async (id, data) => {
    const updated = await apiUpdate(id, data);
    set({
      widgets: get().widgets.map((w) => (w.id === id ? updated : w)),
    });
  },

  deleteWidget: async (id) => {
    await apiDelete(id);
    set({ widgets: get().widgets.filter((w) => w.id !== id) });
  },

  reorderWidgets: async (order) => {
    // Optimistic update
    const reordered = order
      .map((id, i) => {
        const w = get().widgets.find((w) => w.id === id);
        return w ? { ...w, displayOrder: i } : null;
      })
      .filter((w): w is DashboardWidget => w !== null);
    set({ widgets: reordered });
    await apiReorder(order);
  },

  setWidgets: (widgets) => set({ widgets }),
}));
