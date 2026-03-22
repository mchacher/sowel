import { useEffect } from "react";
import { create } from "zustand";
import { getPlugins } from "../../api";

interface PluginUpdateState {
  count: number;
  refresh: () => void;
}

const usePluginUpdateStore = create<PluginUpdateState>((set) => ({
  count: 0,
  refresh: () => {
    getPlugins()
      .then((plugins) => set({ count: plugins.filter((p) => p.latestVersion).length }))
      .catch(() => {});
  },
}));

/** Returns the number of plugins with available updates. Auto-fetches on first admin mount. */
export function usePluginUpdates(isAdmin: boolean): number {
  const count = usePluginUpdateStore((s) => s.count);
  const refresh = usePluginUpdateStore((s) => s.refresh);

  useEffect(() => {
    if (isAdmin) refresh();
  }, [isAdmin, refresh]);

  return count;
}

/** Call this after a plugin update/install/uninstall to refresh the count everywhere. */
export function refreshPluginUpdateCount(): void {
  usePluginUpdateStore.getState().refresh();
}
