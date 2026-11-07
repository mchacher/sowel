import { useSyncExternalStore } from "react";

// 639 px on purpose, not lg: a tablet keeps the desktop content layouts (tiles, tables) while its chrome is mobile up to 1024 px (spec 196).
const query = "(max-width: 639px)";

function subscribe(callback: () => void): () => void {
  const mq = window.matchMedia(query);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  return window.matchMedia(query).matches;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
