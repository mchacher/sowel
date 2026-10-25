import { resolve } from "node:path";
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import type { Logger } from "../core/logger.js";

/** Newest `.hot/*` copies kept, for in-flight code still holding old references. */
const HOT_DIRS_KEPT = 2;

let lastStamp = 0;

/**
 * Copy a package's `dist/` to a fresh `.hot/<stamp>/` directory and return
 * that directory, for the caller to import its entry from.
 *
 * Node ESM caches modules by canonical URL forever. A `?t=...` query only
 * cache-busts the entry we explicitly call `import()` on; relative imports
 * inside that entry (e.g. `import "./i18n.js"`) resolve to their canonical
 * URL and come back from the cache, so a hot-reload would run the new entry
 * against the old version of every file it imports. A fresh directory gives
 * each load a brand new URL space, transitive imports included.
 *
 * The stamp is `Date.now()`, bumped when two loads land in the same
 * millisecond: reusing a directory would reuse its cached URLs.
 */
export function hotCopyDist(pkgDir: string, logger: Logger): string {
  const distDir = resolve(pkgDir, "dist");
  if (!existsSync(distDir)) {
    throw new Error(`Package dist directory not found: ${distDir}`);
  }
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  const hotRoot = resolve(pkgDir, ".hot");
  const hotDir = resolve(hotRoot, String(lastStamp));
  cpSync(distDir, hotDir, { recursive: true });
  pruneOldHotDirs(hotRoot, String(lastStamp), HOT_DIRS_KEPT, logger);
  return hotDir;
}

/**
 * Keep the copy just made plus the `keep - 1` newest others in the package's
 * `.hot/` directory. The current copy is never a candidate: stamps left by a
 * clock that ran ahead (a data volume moved between hosts, a boot before NTP)
 * would otherwise outrank it and get it deleted before its import.
 * Older entries are removed best-effort — a failure here is non-fatal
 * (the package keeps working, the disk just keeps a few extra dirs).
 */
function pruneOldHotDirs(hotRoot: string, current: string, keep: number, logger: Logger): void {
  if (!existsSync(hotRoot)) return;
  try {
    const entries = readdirSync(hotRoot)
      .filter((n) => /^\d+$/.test(n) && n !== current)
      .map((n) => ({ name: n, ts: Number(n) }))
      .sort((a, b) => b.ts - a.ts);
    for (const e of entries.slice(keep - 1)) {
      try {
        rmSync(resolve(hotRoot, e.name), { recursive: true, force: true });
      } catch (err) {
        logger.debug({ err, hotDir: e.name }, "Failed to prune hot dir (non-fatal)");
      }
    }
  } catch (err) {
    logger.debug({ err, hotRoot }, "Failed to list hot dir (non-fatal)");
  }
}
