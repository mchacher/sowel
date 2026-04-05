import { useState, useEffect } from "react";
import { getSystemVersion } from "../api";

/**
 * Checks if a Sowel update is available.
 * Polls on mount + every 30 minutes.
 */
export function useUpdateAvailable(): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const info = await getSystemVersion();
        if (!cancelled) setAvailable(info.updateAvailable);
      } catch {
        // ignore — user might not be admin
      }
    };

    check();
    const timer = setInterval(check, 30 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return available;
}
