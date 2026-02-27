import { create } from "zustand";
import type { CalendarProfile, CalendarSlot, CalendarModeAction } from "../types";
import {
  getCalendarProfiles,
  getActiveCalendar,
  setActiveProfile as apiSetActive,
  getProfileSlots,
  addCalendarSlot as apiAddSlot,
  updateCalendarSlot as apiUpdateSlot,
  deleteCalendarSlot as apiDeleteSlot,
} from "../api";

interface CalendarState {
  profiles: CalendarProfile[];
  activeProfileId: string | null;
  slots: CalendarSlot[];
  loading: boolean;
  fetchProfiles: () => Promise<void>;
  fetchActive: () => Promise<void>;
  setActiveProfile: (profileId: string) => Promise<void>;
  fetchSlots: (profileId: string) => Promise<void>;
  addSlot: (profileId: string, data: { days: number[]; time: string; modeActions: CalendarModeAction[] }) => Promise<void>;
  updateSlot: (slotId: string, data: { days?: number[]; time?: string; modeActions?: CalendarModeAction[] }) => Promise<void>;
  deleteSlot: (slotId: string) => Promise<void>;
}

export const useCalendar = create<CalendarState>((set, get) => ({
  profiles: [],
  activeProfileId: null,
  slots: [],
  loading: false,

  fetchProfiles: async () => {
    try {
      const profiles = await getCalendarProfiles();
      set({ profiles });
    } catch {
      // ignore
    }
  },

  fetchActive: async () => {
    set({ loading: true });
    try {
      const { profile, slots } = await getActiveCalendar();
      set({ activeProfileId: profile.id, slots, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  setActiveProfile: async (profileId) => {
    const { profile, slots } = await apiSetActive(profileId);
    set({ activeProfileId: profile.id, slots });
  },

  fetchSlots: async (profileId) => {
    const slots = await getProfileSlots(profileId);
    set({ slots });
  },

  addSlot: async (profileId, data) => {
    await apiAddSlot(profileId, data);
    await get().fetchSlots(profileId);
  },

  updateSlot: async (slotId, data) => {
    await apiUpdateSlot(slotId, data);
    const activeId = get().activeProfileId;
    if (activeId) await get().fetchSlots(activeId);
  },

  deleteSlot: async (slotId) => {
    await apiDeleteSlot(slotId);
    const activeId = get().activeProfileId;
    if (activeId) await get().fetchSlots(activeId);
  },
}));
