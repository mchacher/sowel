import { create } from "zustand";

export type EnergyUnit = "wh" | "eur";

const ENERGY_UNIT_KEY = "sowel_energy_unit";

function loadEnergyUnit(): EnergyUnit {
  try {
    return localStorage.getItem(ENERGY_UNIT_KEY) === "eur" ? "eur" : "wh";
  } catch {
    return "wh";
  }
}

function saveEnergyUnit(v: EnergyUnit): void {
  try {
    localStorage.setItem(ENERGY_UNIT_KEY, v);
  } catch {
    // ignore
  }
}

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
  /** Spec 123 — Energy page Wh / € display unit, persisted in localStorage. */
  energyUnit: EnergyUnit;
  setEnergyUnit: (v: EnergyUnit) => void;
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
  energyUnit: loadEnergyUnit(),
  setEnergyUnit: (v) => {
    saveEnergyUnit(v);
    set({ energyUnit: v });
  },
}));
