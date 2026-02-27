// ============================================================
// Duration parsing helpers (shared across recipes)
// ============================================================

/**
 * Parse a duration string ("10m", "30s", "1h") into milliseconds.
 * Also accepts a raw number (treated as ms).
 */
export function parseDuration(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") throw new Error(`Invalid duration: ${value}`);

  const match = value.match(/^(\d+)\s*(s|m|h)$/);
  if (!match) throw new Error(`Invalid duration format: ${value}. Use e.g. "10m", "30s", "1h"`);

  const num = parseInt(match[1], 10);
  switch (match[2]) {
    case "s":
      return num * 1000;
    case "m":
      return num * 60 * 1000;
    case "h":
      return num * 60 * 60 * 1000;
    default:
      throw new Error(`Invalid duration unit: ${match[2]}`);
  }
}

/**
 * Format milliseconds into a human-readable duration string.
 */
export function formatDuration(ms: number): string {
  if (ms >= 60 * 60 * 1000) return `${Math.round(ms / (60 * 60 * 1000))}h`;
  if (ms >= 60 * 1000) return `${Math.round(ms / (60 * 1000))}min`;
  return `${Math.round(ms / 1000)}s`;
}
