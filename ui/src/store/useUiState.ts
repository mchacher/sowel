import { create } from "zustand";

interface UiState {
  zoneDrawerOpen: boolean;
  openZoneDrawer: () => void;
  closeZoneDrawer: () => void;
  energyNavOpen: boolean;
  openEnergyNav: () => void;
  closeEnergyNav: () => void;
  analyseNavOpen: boolean;
  openAnalyseNav: () => void;
  closeAnalyseNav: () => void;
}

export const useUiState = create<UiState>((set) => ({
  zoneDrawerOpen: false,
  openZoneDrawer: () => set({ zoneDrawerOpen: true }),
  closeZoneDrawer: () => set({ zoneDrawerOpen: false }),
  energyNavOpen: false,
  openEnergyNav: () => set({ energyNavOpen: true }),
  closeEnergyNav: () => set({ energyNavOpen: false }),
  analyseNavOpen: false,
  openAnalyseNav: () => set({ analyseNavOpen: true }),
  closeAnalyseNav: () => set({ analyseNavOpen: false }),
}));
