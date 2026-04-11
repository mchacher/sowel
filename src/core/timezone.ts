// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — tz-lookup ships no type declarations
import tzLookup from "tz-lookup";
import type Database from "better-sqlite3";

export type TimezoneSource = "env" | "auto" | "fallback";

export interface TimezoneResult {
  /** IANA timezone name (e.g. "Europe/Paris", "America/New_York", "UTC") */
  tz: string;
  /** How it was determined */
  source: TimezoneSource;
  /**
   * Diagnostic messages that should be logged AFTER the logger is created.
   * We run BEFORE the logger exists to avoid caching the wrong TZ in V8.
   */
  diag: string[];
}

export interface DetectTimezoneOptions {
  latitude?: number | null;
  longitude?: number | null;
  tzEnv?: string | undefined;
}

/**
 * Determines which timezone Sowel should operate in.
 *
 * Priority:
 *   1. TZ env var (if set at startup) — explicit override
 *   2. Auto-derive from home.latitude/longitude via tz-lookup
 *   3. Fallback to UTC with a warning
 *
 * Does NOT log directly — returns diagnostic messages that the caller
 * must log via the real logger once it is created.
 *
 * ⚠️ Call this BEFORE `createLogger()` — pino touches Date on first log,
 * which caches the TZ in V8 permanently.
 */
export function detectTimezone(opts: DetectTimezoneOptions): TimezoneResult {
  const diag: string[] = [];

  // Priority 1: env var
  const tzEnv = opts.tzEnv?.trim();
  if (tzEnv) {
    diag.push(`Timezone set from TZ env var: ${tzEnv}`);
    return { tz: tzEnv, source: "env", diag };
  }

  // Priority 2: geo lookup
  const { latitude, longitude } = opts;
  if (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  ) {
    try {
      const tz = tzLookup(latitude, longitude) as string;
      diag.push(`Timezone detected from home location: ${tz} (lat=${latitude}, lon=${longitude})`);
      return { tz, source: "auto", diag };
    } catch (err) {
      diag.push(
        `Failed to derive timezone from home location (lat=${latitude}, lon=${longitude}): ${
          err instanceof Error ? err.message : String(err)
        }. Falling back to UTC.`,
      );
    }
  }

  // Priority 3: fallback
  diag.push(
    "Timezone not configured: using UTC. Set home.latitude/home.longitude in Settings or TZ env var in docker-compose.yml for correct local time.",
  );
  return { tz: "UTC", source: "fallback", diag };
}

export interface TimezoneProbe {
  /** Full Date.toString() output — includes TZ abbreviation (CEST, EDT, ...) */
  probe: string;
  /** Hours offset from UTC (positive east, e.g. +2 for CEST) */
  offsetHours: number;
}

/**
 * Probe the runtime to confirm Node picked up the TZ change.
 *
 * ⚠️ Call AFTER `process.env.TZ = <tz>` and BEFORE any other Date-using code.
 */
export function probeTimezone(): TimezoneProbe {
  const now = new Date();
  return {
    probe: now.toString(),
    offsetHours: -now.getTimezoneOffset() / 60,
  };
}

/**
 * Raw SQLite read of home coordinates from the `settings` table.
 * Does NOT require a full `SettingsManager` — used during the early boot
 * phase before the logger and managers are instantiated.
 *
 * Returns `{ latitude: null, longitude: null }` if either is missing or invalid.
 */
export function readHomeCoordinatesRaw(db: Database.Database): {
  latitude: number | null;
  longitude: number | null;
} {
  const rows = db
    .prepare("SELECT key, value FROM settings WHERE key IN ('home.latitude', 'home.longitude')")
    .all() as { key: string; value: string }[];

  const map = new Map(rows.map((r) => [r.key, r.value]));
  const latStr = map.get("home.latitude");
  const lonStr = map.get("home.longitude");

  const lat = latStr ? parseFloat(latStr) : null;
  const lon = lonStr ? parseFloat(lonStr) : null;

  return {
    latitude: lat !== null && Number.isFinite(lat) ? lat : null,
    longitude: lon !== null && Number.isFinite(lon) ? lon : null,
  };
}
