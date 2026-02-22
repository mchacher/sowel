import { useEffect, useRef } from "react";
import { useWebSocket } from "../store/useWebSocket";
import type { WsTopic } from "../store/useWebSocket";

/**
 * Subscribe to specific WebSocket topics for the current page.
 * "system" is always included automatically by the backend.
 *
 * Usage: useWsSubscription(["zones", "equipments", "modes"]);
 */
export function useWsSubscription(topics: WsTopic[]): void {
  const subscribe = useWebSocket((s) => s.subscribe);
  const status = useWebSocket((s) => s.status);
  const topicsKey = topics.join(",");
  const prevKey = useRef("");

  useEffect(() => {
    if (status !== "connected") return;
    // Only re-subscribe if topics actually changed
    if (prevKey.current === topicsKey) return;
    prevKey.current = topicsKey;
    subscribe(topics);
  }, [status, topicsKey, subscribe, topics]);
}
