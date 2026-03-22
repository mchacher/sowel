import { useState, useEffect } from "react";
import { getPlugins } from "../../api";

/** Returns the number of plugins with available updates. Fetches once on mount. */
export function usePluginUpdates(isAdmin: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isAdmin) return;
    getPlugins()
      .then((plugins) => setCount(plugins.filter((p) => p.latestVersion).length))
      .catch(() => {});
  }, [isAdmin]);

  return count;
}
