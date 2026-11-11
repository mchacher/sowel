import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * Route-level code splitting (#1187): a page that is not on the first screen
 * is fetched when it is first visited, not with the first load.
 *
 * A split bundle brings one failure the single bundle never had. A tab opened
 * before an update still runs the old `index.html`, whose chunk names no longer
 * exist on the server once the update is in. The import then fails, and the
 * page would show an error. The cure is to reload, which fetches the current
 * `index.html` and its chunks. One automatic reload per window, so a chunk the
 * server really lacks ends on the error page with its "Reload page" button
 * instead of looping. When the server does not answer at all (offline, backend
 * restarting), nothing is stale: the spinner stays and the chunk is retried.
 */

const RELOAD_KEY = "sowel_chunk_reload_at";
export const CHUNK_RELOAD_WINDOW_MS = 10_000;
const RETRY_DELAY_MS = 5_000;

export interface ChunkReloadDeps {
  storage: Pick<Storage, "getItem" | "setItem">;
  reload: () => void;
  now: () => number;
  /** Whether the server answers at all: a failed chunk on a dead network is not a stale chunk. */
  serverReachable: () => Promise<boolean>;
  /** Resolves when it is worth trying again: back online, or after a delay. */
  waitToRetry: () => Promise<void>;
}

function browserDeps(): ChunkReloadDeps {
  return {
    // Read on use, inside the callers' try: a browser where the property
    // itself throws must not break every lazy page.
    storage: {
      getItem: (k) => window.sessionStorage.getItem(k),
      setItem: (k, v) => window.sessionStorage.setItem(k, v),
    },
    reload: () => window.location.reload(),
    now: Date.now,
    serverReachable: async () => {
      if (navigator.onLine === false) return false;
      try {
        // A proxy in front of a restarting backend answers 502: not ok either.
        const res = await fetch("/index.html", { cache: "no-store", method: "HEAD" });
        return res.ok;
      } catch {
        return false;
      }
    },
    waitToRetry: () =>
      new Promise<void>((resolve) => {
        const done = () => {
          window.removeEventListener("online", done);
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(done, RETRY_DELAY_MS);
        window.addEventListener("online", done);
      }),
  };
}

export function importWithReload<T>(
  load: () => Promise<T>,
  deps: ChunkReloadDeps = browserDeps(),
): Promise<T> {
  return load().catch(async (err: unknown): Promise<T> => {
    // Network down (Wi-Fi lost, backend restarting during an update): a
    // reload would land on the browser's own error page. Keep the spinner
    // and try the chunk again once the server answers.
    if (!(await deps.serverReachable())) {
      console.warn("[lazy-page] chunk failed while the server is unreachable, retrying", err);
      await deps.waitToRetry();
      return importWithReload(load, deps);
    }
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
