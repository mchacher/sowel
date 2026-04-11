import { useEffect } from "react";
import { getSystemVersion } from "../api";
import { useWebSocket } from "../store/useWebSocket";

/**
 * Returns true when a Sowel update is available.
 *
 * Strategy:
 * - Initial check at mount (covers the case where WS isn't connected yet,
 *   or where the user opens the UI long after a release was published)
 * - Then relies on the WebSocket push of `system.update.available` for
 *   real-time updates (no more 30-min polling)
 */
export function useUpdateAvailable(): boolean {
  const updateAvailable = useWebSocket((s) => s.updateAvailable);
  const setUpdateAvailable = useWebSocket((s) => s.setUpdateAvailable);

  useEffect(() => {
    let cancelled = false;
    getSystemVersion()
      .then((info) => {
        if (cancelled) return;
        if (info.updateAvailable && info.latest) {
          setUpdateAvailable({
            current: info.current,
            latest: info.latest,
            releaseUrl: info.releaseUrl ?? "",
          });
        } else {
          setUpdateAvailable(null);
        }
      })
      .catch(() => {
        // ignore — user might not be admin
      });
    return () => {
      cancelled = true;
    };
  }, [setUpdateAvailable]);

  return updateAvailable !== null;
}
