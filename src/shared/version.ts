/**
 * Simple semver comparison: returns true if `a` is strictly newer than `b`.
 * Shared by every "is an update available?" check so a stale or rolled-back
 * remote version can never be advertised as an update (spec 136 fix).
 */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}
