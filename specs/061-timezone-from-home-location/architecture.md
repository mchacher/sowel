# Architecture — Spec 061

## Flow at startup

```
src/index.ts (entry point)
  │
  ├─ 1. Load settings from DB (read-only, before any Date-using module)
  │
  ├─ 2. detectTimezone({ latitude, longitude, tzEnv: process.env.TZ, logger })
  │     │
  │     ├─ if tzEnv is already set → return tzEnv (no override)
  │     ├─ if latitude && longitude → tzLookup(lat, lon) → return TZ
  │     └─ else → return "UTC" + log WARN
  │
  ├─ 3. process.env.TZ = detected_tz
  │     (⚠️ MUST happen before any Date method or cron is used)
  │
  ├─ 4. Continue normal startup: create managers, server, etc.
  │     All Date methods, crons, suncalc, etc. now use the correct TZ
```

## Key insight

**`process.env.TZ` must be set before the first Date method is called**, otherwise Node.js caches the TZ internally and subsequent changes don't take effect. The `detectTimezone()` function runs at the very start of `main()`, before any manager is instantiated.

## New module: `src/core/timezone.ts`

```typescript
import tzLookup from "tz-lookup";
import type { Logger } from "./logger.js";

export interface DetectTimezoneOptions {
  latitude?: number | null;
  longitude?: number | null;
  tzEnv?: string | undefined; // process.env.TZ at startup
  logger: Logger;
}

/**
 * Determines which timezone Sowel should operate in.
 *
 * Priority:
 *   1. TZ env var (if set at startup) — explicit override
 *   2. Auto-derive from home.latitude/longitude via tz-lookup
 *   3. Fallback to UTC with a warning
 *
 * Returns an IANA timezone name (e.g., "Europe/Paris").
 */
export function detectTimezone(opts: DetectTimezoneOptions): string {
  const { latitude, longitude, tzEnv, logger } = opts;
  const tzLogger = logger.child({ module: "timezone" });

  // Priority 1: env var
  if (tzEnv && tzEnv.trim()) {
    tzLogger.info({ tz: tzEnv }, "Timezone set from TZ env var");
    return tzEnv.trim();
  }

  // Priority 2: auto-derive from coordinates
  if (typeof latitude === "number" && typeof longitude === "number") {
    try {
      const tz = tzLookup(latitude, longitude);
      tzLogger.info({ tz, latitude, longitude }, "Timezone detected from home location");
      return tz;
    } catch (err) {
      tzLogger.warn(
        { err, latitude, longitude },
        "Failed to derive timezone from home location, falling back to UTC",
      );
    }
  }

  // Priority 3: fallback
  tzLogger.warn(
    "Timezone not configured: using UTC. Set home.latitude/longitude in Settings or TZ env var in docker-compose.yml for correct local time.",
  );
  return "UTC";
}
```

## Integration in `src/index.ts`

Near the top of `main()`, after opening the database and loading settings:

```typescript
// Load settings BEFORE creating any manager (for timezone detection)
const settings = new SettingsManager(db, logger);
const latStr = settings.get("home.latitude");
const lonStr = settings.get("home.longitude");
const latitude = latStr ? parseFloat(latStr) : null;
const longitude = lonStr ? parseFloat(lonStr) : null;

const detectedTz = detectTimezone({
  latitude: isNaN(latitude ?? NaN) ? null : latitude,
  longitude: isNaN(longitude ?? NaN) ? null : longitude,
  tzEnv: process.env.TZ,
  logger,
});

// Set TZ globally — affects all subsequent Date methods
process.env.TZ = detectedTz;

// Continue normal startup...
```

⚠️ **Caveat on runtime changes**: Node.js caches the TZ internally on the first Date method call. Changing `process.env.TZ` at runtime does NOT affect already-loaded Date behavior. Hence the FR4 restart requirement.

## Integration with croner

`croner` uses the system TZ by default. Once `process.env.TZ` is set at boot, croner automatically uses it. **No code change in `calendar-manager.ts`**.

## Integration with suncalc

`suncalc` returns Date objects with absolute timestamps (they're always correct). The issue is only in how Sowel **formats** those dates. Once `Date.prototype.getHours()` returns CEST hours, the existing `formatTime()` in `sunlight-manager.ts` works correctly.

**No code change in `sunlight-manager.ts`**.

## Integration with tariff-classifier, energy-aggregator, notifications

Same reasoning — they all use native Date methods. **No code change**.

## Settings change handler

In `SettingsManager` or wherever `home.latitude`/`home.longitude` are updated:

```typescript
if (keys.includes("home.latitude") || keys.includes("home.longitude")) {
  this.logger.warn("Home location changed. Restart Sowel for timezone changes to fully apply.");
  // Optionally: emit an event to the UI
  this.eventBus.emit({
    type: "system.restart_required",
    reason: "timezone_changed",
  });
}
```

UI listens for this event and shows a toast.

## Repo `docker-compose.yml` update

```yaml
services:
  sowel:
    image: ghcr.io/mchacher/sowel:latest
    container_name: sowel
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      # Timezone: by default, Sowel auto-derives from home.latitude/longitude
      # in Settings. To override explicitly, uncomment and set:
      # - TZ=Europe/Paris
      - INFLUX_URL=http://influxdb:8086
      # ... rest unchanged
```

## Files changed

| Domain | File                              | Change                                              |
| ------ | --------------------------------- | --------------------------------------------------- |
| Core   | `src/core/timezone.ts` (NEW)      | `detectTimezone()` helper                           |
| Core   | `src/core/timezone.test.ts` (NEW) | Unit tests for detection logic                      |
| Core   | `src/index.ts`                    | Call `detectTimezone()` early, set `process.env.TZ` |
| Core   | `src/core/settings-manager.ts`    | Emit warn/event on home.latitude/longitude change   |
| Shared | `src/shared/types.ts`             | New event type `system.restart_required` (optional) |
| UI     | `ui/src/store/useWebSocket.ts`    | Handle `system.restart_required` event              |
| UI     | `ui/src/pages/SettingsPage.tsx`   | Toast on home location change success               |
| Infra  | `docker-compose.yml` (repo root)  | Add commented TZ example                            |
| Docs   | `README.md`                       | Timezone section                                    |
| Deps   | `package.json`                    | Add `tz-lookup` dependency                          |

## Why this design

- **Minimal code changes**: one new helper + one line in `index.ts`. No refactor of 15+ call sites
- **Zero-config for 90% of users**: they already set lat/lon for sunlight — timezone is derived for free
- **Escape hatch**: `TZ` env var remains the ultimate override for unusual deployments
- **Clear failure mode**: when nothing is configured, loud WARN log tells the user what to do
- **Respects Node.js limitations**: TZ is set once at boot, documented restart requirement for changes
