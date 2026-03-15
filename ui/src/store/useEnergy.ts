import { create } from "zustand";
import type { EnergyHistoryResponse } from "../types";
import { getEnergyHistory, getEnergyStatus } from "../api";

type Period = "day" | "week" | "month" | "year";

interface EnergyState {
  period: Period;
  date: string; // YYYY-MM-DD
  history: EnergyHistoryResponse | null;
  available: boolean | null; // null = not checked yet
  loading: boolean;
  error: string | null;

  setPeriod: (period: Period) => void;
  setDate: (date: string) => void;
  navigateDate: (direction: -1 | 1) => void;
  fetchHistory: () => Promise<void>;
  checkAvailability: () => Promise<void>;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Check whether advancing one period would go beyond today. */
export function canGoForward(dateStr: string, period: Period): boolean {
  const today = new Date(todayStr() + "T12:00:00");
  const d = new Date(dateStr + "T12:00:00");
  switch (period) {
    case "day":
      return d < today;
    case "week": {
      // Current week contains today → can't go forward
      const dayOfWeek = d.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(d);
      monday.setDate(monday.getDate() + mondayOffset);
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      return sunday < today;
    }
    case "month":
      return d.getFullYear() < today.getFullYear() ||
        (d.getFullYear() === today.getFullYear() && d.getMonth() < today.getMonth());
    case "year":
      return d.getFullYear() < today.getFullYear();
  }
}

function shiftDate(dateStr: string, period: Period, direction: -1 | 1): string {
  const d = new Date(dateStr + "T12:00:00");
  switch (period) {
    case "day":
      d.setDate(d.getDate() + direction);
      break;
    case "week":
      d.setDate(d.getDate() + direction * 7);
      break;
    case "month":
      d.setMonth(d.getMonth() + direction);
      break;
    case "year":
      d.setFullYear(d.getFullYear() + direction);
      break;
  }
  return d.toISOString().slice(0, 10);
}

export const useEnergy = create<EnergyState>((set, get) => ({
  period: "day",
  date: todayStr(),
  history: null,
  available: null,
  loading: false,
  error: null,

  setPeriod: (period) => {
    set({ period });
    get().fetchHistory();
  },

  setDate: (date) => {
    set({ date });
    get().fetchHistory();
  },

  navigateDate: (direction) => {
    const { date, period } = get();
    // Block navigation into the future
    if (direction === 1 && !canGoForward(date, period)) return;
    const newDate = shiftDate(date, period, direction);
    set({ date: newDate });
    get().fetchHistory();
  },

  fetchHistory: async () => {
    const { period, date } = get();
    set({ loading: true, error: null });
    try {
      const history = await getEnergyHistory(period, date);
      set({ history, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  checkAvailability: async () => {
    try {
      const status = await getEnergyStatus();
      set({ available: status.available });
    } catch {
      set({ available: false });
    }
  },
}));
