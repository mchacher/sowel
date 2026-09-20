import { useEffect } from "react";
import { create } from "zustand";
import { getPluginPages } from "../../api";
import type { PluginPageInfo } from "../../types";

interface PluginPagesState {
  pages: PluginPageInfo[];
  refresh: () => void;
}

const usePluginPagesStore = create<PluginPagesState>((set) => ({
  pages: [],
  refresh: () => {
    getPluginPages()
      .then((pages) => set({ pages }))
      .catch(() => {
        // A sidebar that cannot list plugin pages shows none, which is the
        // same thing it showed before any plugin brought one.
        set({ pages: [] });
      });
  },
}));

/** Spec 180 — the pages installed plugins add to the Administration menu. */
export function usePluginPages(isAdmin: boolean): PluginPageInfo[] {
  const pages = usePluginPagesStore((s) => s.pages);
  const refresh = usePluginPagesStore((s) => s.refresh);

  useEffect(() => {
    if (isAdmin) refresh();
  }, [isAdmin, refresh]);

  return pages;
}

/** Call after an install, update, uninstall, enable or disable. */
export function refreshPluginPages(): void {
  usePluginPagesStore.getState().refresh();
}
