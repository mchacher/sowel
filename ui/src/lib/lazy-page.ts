import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * Route-level code splitting (#1187): a page that is not on the first screen
 * is fetched when it is first visited, not with the first load.
 *
 * A split bundle brings one failure the single bundle never had. A tab opened
 * before an update still runs the old `index.html`, whose chunk names no longer
 * exist on the server once the update is in. The import then fails, and the
 * page would show an error. The cure is to reload, which fetches the current
 * `index.html` and its chunks. One automatic reload per window, so a chunk that
 * is genuinely unreachable (offline, server down) ends on the error page with
 * its "Reload page" button instead of looping.
 */

const RELOAD_KEY = "sowel_chunk_reload_at";
export const CHUNK_RELOAD_WINDOW_MS = 10_000;

export interface ChunkReloadDeps {
  storage: Pick<Storage, "getItem" | "setItem">;
  reload: () => void;
  now: () => number;
}

function browserDeps(): ChunkReloadDeps {
  return {
    storage: window.sessionStorage,
    reload: () => window.location.reload(),
    now: Date.now,
  };
}

export function importWithReload<T>(
  load: () => Promise<T>,
  deps: ChunkReloadDeps = browserDeps(),
): Promise<T> {
  return load().catch((err: unknown) => {
    let last: number;
    try {
      last = Number(deps.storage.getItem(RELOAD_KEY)) || 0;
    } catch {
      // Storage blocked (private mode, site data refused): without the guard,
      // reloading could loop, so surface the error instead.
      throw err;
    }
    const now = deps.now();
    if (now - last < CHUNK_RELOAD_WINDOW_MS) throw err;
    try {
      deps.storage.setItem(RELOAD_KEY, String(now));
    } catch {
      throw err;
    }
    console.warn("[lazy-page] chunk failed to load, reloading once", err);
    deps.reload();
    // Never settles: the page is going away, and the Suspense fallback stays
    // on screen until it does.
    return new Promise<T>(() => {});
  });
}

/**
 * `React.lazy` for a page module's named export:
 * `lazyPage(() => import("./pages/LogsPage"), "LogsPage")`.
 */
export function lazyPage<K extends string>(
  load: () => Promise<Record<K, ComponentType>>,
  name: K,
): LazyExoticComponent<ComponentType> {
  return lazy(() =>
    importWithReload(load).then((m): { default: ComponentType } => ({ default: m[name] })),
  );
}
