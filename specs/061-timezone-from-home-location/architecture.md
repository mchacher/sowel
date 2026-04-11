# Architecture — Spec 061

## Flow at startup (critical ordering)

```
src/index.ts main()
  │
  ├─ 1. loadConfig()                        [no Date methods]
  ├─ 2. acquirePidLock()                    [no Date methods — file ops only]
  ├─ 3. openDatabase()                      [no Date methods — sync SQLite]
  │
  ├─ 4. readSettingsRaw(db, "home.*")       [raw SQLite read — no SettingsManager yet]
  │      └─ returns { latitude, longitude }
  │
  ├─ 5. detectTimezone({ latitude, longitude, tzEnv: process.env.TZ })
  │      (uses console.log for any diagnostics — logger doesn't exist yet)
  │
  ├─ 6. process.env.TZ = detectedTz         ⚠️ MUST happen before step 7
  │
  ├─ 7. sanityCheckTz(detectedTz)           [new Date().toString() probe]
  │      └─ cached diag object to log once the logger is up
  │
  ├─ 8. createLogger()                      [NOW Date methods start using the right TZ]
  │
  ├─ 9. logger.info(tzDiag, "Timezone applied")   [flush the deferred diag]
  │
  ├─ 10. runMigrations(db, ...)
  ├─ 11. new SettingsManager(db)            [full manager now]
  ├─ 12. ... all other managers ...
```

**Key insight**: `process.env.TZ` must be set **before any `new Date()` call**. The first `new Date()` happens inside the pino logger at `createLogger()` time (pino's `isoTime` formatter calls `new Date()` to build the timestamp). Once Date is called, V8 caches the TZ internally and subsequent `process.env.TZ` changes have no effect on already-loaded `Date.prototype` methods.

**Consequence**: we can NOT use the real `logger` or `SettingsManager` during timezone detection. We use raw SQLite reads and `console.log` for any diagnostics, then log the results through the real logger after it's created.

## New module: `src/core/timezone.ts`

```typescript
import tzLookup from "tz-lookup";

export type TimezoneSource = "env" | "auto" | "fallback";

export interface TimezoneResult {
  tz: string; // IANA name, e.g. "Europe/Paris"
  source: TimezoneSource; // how it was determined
  diag: string[]; // diagnostic messages to be logged after logger creation
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
 * must log via the real logger once it is created (we run BEFORE the
 * logger exists to avoid caching the wrong TZ in V8).
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
      const tz = tzLookup(latitude, longitude);
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

/**
 * Probe the runtime to confirm Node picked up the TZ change.
 * Call AFTER `process.env.TZ = <tz>` and BEFORE any other Date.
 */
export function probeTimezone(): { probe: string; offsetHours: number } {
  const now = new Date();
  return {
    probe: now.toString(),
    offsetHours: -now.getTimezoneOffset() / 60,
  };
}
```

## Helper: raw settings read (before SettingsManager exists)

```typescript
// src/core/timezone.ts (same file)
import type Database from "better-sqlite3";

export function readHomeCoordinatesRaw(db: Database.Database): {
  latitude: number | null;
  longitude: number | null;
} {
  // The settings table uses { key, value } schema with value stored as TEXT
  const row = db
    .prepare("SELECT key, value FROM settings WHERE key IN ('home.latitude', 'home.longitude')")
    .all() as { key: string; value: string }[];

  const map = new Map(row.map((r) => [r.key, r.value]));
  const latStr = map.get("home.latitude");
  const lonStr = map.get("home.longitude");

  const lat = latStr ? parseFloat(latStr) : null;
  const lon = lonStr ? parseFloat(lonStr) : null;

  return {
    latitude: lat !== null && Number.isFinite(lat) ? lat : null,
    longitude: lon !== null && Number.isFinite(lon) ? lon : null,
  };
}
```

## Integration in `src/index.ts`

```typescript
// At the top of main(), before logger creation:

// 1. Config + PID lock (no Date)
const config = loadConfig();
acquirePidLock(dataDir);

// 2. Open DB (no Date)
const db = openDatabase(config.sqlite.path, /* no logger yet */ undefined);
// NOTE: openDatabase() must accept an optional logger (minor refactor)

// 3. Read home coords raw
const { latitude, longitude } = readHomeCoordinatesRaw(db);

// 4. Detect timezone
const tzResult = detectTimezone({
  latitude,
  longitude,
  tzEnv: process.env.TZ,
});

// 5. Set process.env.TZ ⚠️ MUST be before any new Date()
process.env.TZ = tzResult.tz;

// 6. Probe to verify
const probe = probeTimezone();

// 7. NOW create the logger (which will use the correct TZ from here on)
const logBuffer = new LogRingBuffer();
const logHandle = createLogger(config.log.level, logBuffer);
const logger = logHandle.logger;

// 8. Flush deferred diagnostics + probe result
for (const msg of tzResult.diag) {
  logger.info({ module: "timezone" }, msg);
}
logger.info(
  { module: "timezone", tz: tzResult.tz, source: tzResult.source, ...probe },
  "Timezone applied",
);

// 9. Sowel branding message
logger.info("Sowel — Founded by Marc Chachereau — AGPL-3.0");

// 10. Run migrations (needs the logger)
runMigrations(db, migrationsDir, logger);

// 11. Create settings manager and continue with the full startup
const settingsManager = new SettingsManager(db);
// ... rest of main() unchanged
```

**Note**: `openDatabase()` currently takes a required `logger` parameter. We need to make it optional (or create a bootstrap mode) so it can be called before the logger exists.

### Persisting the TimezoneResult

Store the `TimezoneResult` globally (or pass it through `ServerDeps`) so that `GET /api/v1/system/timezone` can return it without re-running detection.

```typescript
// src/index.ts
const tzInfo = { tz: tzResult.tz, source: tzResult.source, offsetHours: probe.offsetHours };
// Pass to createServer via ServerDeps
```

## New API endpoint: `GET /api/v1/system/timezone`

In `src/api/routes/system.ts`:

```typescript
app.get("/api/v1/system/timezone", async (request, reply) => {
  if (!request.auth || request.auth.role !== "admin") {
    return reply.code(403).send({ error: "Admin access required" });
  }
  return tzInfo; // { tz, source, offsetHours }
});
```

No admin-only? For FR7 (current time pill in banner), ALL users need access. Alternative: make the endpoint accessible to any authenticated user, or include the TZ in a broader `GET /api/v1/system/config` that's already auth-light.

**Decision**: require auth but NOT admin. The pill is visible to any logged-in user.

## New API endpoint: `POST /api/v1/system/restart`

In `src/api/routes/system.ts`:

```typescript
app.post("/api/v1/system/restart", async (request, reply) => {
  if (!request.auth || request.auth.role !== "admin") {
    return reply.code(403).send({ error: "Admin access required" });
  }
  if (!updateManager.isDockerAvailable()) {
    return reply.code(400).send({ error: "Docker socket not available" });
  }
  if (!updateManager.isComposeManaged()) {
    return reply.code(400).send({ error: "Sowel is not managed by docker compose" });
  }

  updateManager.restartViaHelper().catch((err) => {
    logger.error({ err }, "Restart-via-helper failed");
  });
  return { success: true, message: "Restarting Sowel..." };
});
```

## `UpdateManager.restartViaHelper()` — reuse helper pattern from spec 060

New method in `src/core/update-manager.ts`:

```typescript
async restartViaHelper(): Promise<void> {
  if (this.updating) {
    throw new Error("An operation is already in progress");
  }
  const ctx = this.getComposeContext();
  if (!ctx) {
    throw new Error("Cannot restart: not managed by docker compose");
  }

  this.updating = true;
  try {
    // Reuse the same spawn logic as update(), but without the pull step
    // and without pre-update backup
    this.emitProgress("spawning", "Spawning restart helper...");
    await this.spawnHelperForRestart(ctx);
    this.emitProgress("spawned", "Restart helper started — Sowel will restart shortly");
  } catch (err) {
    this.updating = false;
    throw err;
  }
}

private async spawnHelperForRestart(ctx: ComposeContext): Promise<void> {
  // Similar to spawnHelper() but with a simpler command:
  // sleep 3 && docker compose up -d <service>
  // No pull, no version in env, no AutoRemove leftover cleanup needed
}
```

Refactor `spawnHelper()` and `spawnHelperForRestart()` to share the common setup (image pull, container creation, binds, etc.) via a private `runHelper(cmd: string)` method.

## Settings change handler

In `SettingsManager` (or the route that updates settings), after the update transaction:

```typescript
if (changedKeys.includes("home.latitude") || changedKeys.includes("home.longitude")) {
  this.logger.warn("Home location changed. Restart Sowel for timezone changes to apply.");
  this.eventBus.emit({ type: "system.restart_required", reason: "timezone_changed" });
}
```

New event type in `src/shared/types.ts`:

```typescript
| { type: "system.restart_required"; reason: string }
```

## UI changes

### 1. Zustand store — `useTimezone`

New store `ui/src/store/useTimezone.ts`:

```typescript
import { create } from "zustand";
import { getSystemTimezone } from "../api";

interface TimezoneState {
  tz: string;
  source: "env" | "auto" | "fallback" | "unknown";
  offsetHours: number;
  loaded: boolean;
  fetch: () => Promise<void>;
}

export const useTimezone = create<TimezoneState>((set) => ({
  tz: "UTC",
  source: "unknown",
  offsetHours: 0,
  loaded: false,
  fetch: async () => {
    try {
      const info = await getSystemTimezone();
      set({ ...info, loaded: true });
    } catch {
      // ignore — pill falls back to browser local
    }
  },
}));
```

Fetched once at app mount in `AppLayout.tsx`.

### 2. New component: `CurrentTimePill`

`ui/src/components/layout/CurrentTimePill.tsx`:

```typescript
import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useTimezone } from "../../store/useTimezone";

export function CurrentTimePill() {
  const tz = useTimezone((s) => s.tz);
  const loaded = useTimezone((s) => s.loaded);
  const [now, setNow] = useState<string>(() => formatHomeTime(tz));

  useEffect(() => {
    if (!loaded) return;
    const tick = () => setNow(formatHomeTime(tz));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [tz, loaded]);

  if (!loaded) return null;

  return (
    <div className="flex items-center gap-1 text-[11px] font-medium tabular-nums text-text-secondary bg-background/80 px-2 py-1 rounded-[6px]">
      <Clock size={12} strokeWidth={1.5} />
      <span>{now}</span>
    </div>
  );
}

function formatHomeTime(tz: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
  } catch {
    // Invalid TZ — fall back to browser local
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
  }
}
```

Displayed in `AppLayout.tsx` header, to the left of `<SunlightBanner>`. Visible on both mobile and desktop.

### 3. Settings page — Timezone display in `HomeSettingsSection`

In `ui/src/pages/SettingsPage.tsx` `HomeSettingsSection`:

- Fetch `useTimezone` at mount (already done by AppLayout)
- Render below the lat/lon fields:

```jsx
<div className="pt-2">
  <label className="block text-[12px] text-text-tertiary uppercase tracking-wider mb-1">
    Fuseau horaire
  </label>
  <div className="flex items-center gap-2">
    <span className="text-[14px] font-mono text-text px-2 py-1 bg-background rounded-[6px] border border-border">
      {tz}
    </span>
    <span className="text-[11px] text-text-tertiary">
      {source === "auto" && "auto-détecté depuis vos coordonnées"}
      {source === "env" && "défini via variable d'environnement TZ"}
      {source === "fallback" && <span className="text-warning">non configuré, UTC par défaut</span>}
    </span>
  </div>
</div>
```

### 4. Settings save → restart flow

In `HomeSettingsSection.onSave`:

```typescript
const handleSave = async () => {
  const didChangeLocation =
    latitude !== initial.latitude || longitude !== initial.longitude;
  await updateSettings(...);

  if (didChangeLocation) {
    setRestartToast(true);
  }
};
```

New component `ui/src/components/system/RestartToast.tsx`:

- Banner/toast with message and two buttons: `[ Restart now ]` / `[ Later ]`
- "Restart now" calls `POST /api/v1/system/restart`, sets the `useWebSocket.updateInProgress` flag, and closes itself
- The existing `UpdateOverlay` takes over (reuse as-is — it polls for version change and reloads)
- Wait — the version won't change after a restart. We need to either:
  - (a) Adjust `UpdateOverlay` to also reload when the WebSocket reconnects after loss (not rely on version change)
  - (b) Use a different trigger, e.g. reload when `/api/v1/health` responds again after downtime

**Decision**: adjust `UpdateOverlay` to reload on **"WS reconnect after loss"** as a fallback when the version matches. That already works for the restart case because the reconnection happens after the container recreation.

Actually looking at the current `UpdateOverlay` code, it already has a "belt and suspenders" effect listening for `wsStatus === "connected"` and reloading. That's enough — the version check just never triggers, but the WS reconnect check does.

### 5. `ui/src/api.ts` additions

```typescript
export interface SystemTimezoneInfo {
  tz: string;
  source: "env" | "auto" | "fallback";
  offsetHours: number;
}

export async function getSystemTimezone(): Promise<SystemTimezoneInfo> {
  return fetchJSON(`${API_BASE}/system/timezone`);
}

export async function triggerSystemRestart(): Promise<{ success: boolean; message: string }> {
  return fetchJSON(`${API_BASE}/system/restart`, { method: "POST" });
}
```

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
      # Optional: explicitly set the timezone. By default, Sowel auto-derives
      # the timezone from home.latitude/home.longitude configured in Settings.
      # Uncomment only if you need to override or if you don't set a home location.
      # - TZ=Europe/Paris
      - INFLUX_URL=http://influxdb:8086
      # ... rest unchanged
```

## Files changed

| Domain   | File                                                 | Change                                                            |
| -------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| Core     | `src/core/timezone.ts` (NEW)                         | `detectTimezone()`, `probeTimezone()`, `readHomeCoordinatesRaw()` |
| Core     | `src/core/timezone.test.ts` (NEW)                    | Unit tests                                                        |
| Core     | `src/index.ts`                                       | Reorder boot: TZ detection BEFORE logger creation                 |
| Core     | `src/core/database.ts`                               | `openDatabase()` logger parameter becomes optional                |
| Core     | `src/core/update-manager.ts`                         | New `restartViaHelper()` method, shared `runHelper()`             |
| Core     | `src/core/settings-manager.ts`                       | Emit `system.restart_required` on home location change            |
| Shared   | `src/shared/types.ts`                                | New `system.restart_required` event type                          |
| API      | `src/api/routes/system.ts`                           | New `GET /system/timezone`, `POST /system/restart` endpoints      |
| API      | `src/api/server.ts`                                  | Pass `tzInfo` through ServerDeps                                  |
| UI types | `ui/src/types.ts`                                    | Add `system.restart_required` to `EngineEvent` union              |
| UI store | `ui/src/store/useTimezone.ts` (NEW)                  | Timezone info store                                               |
| UI store | `ui/src/store/useWebSocket.ts`                       | Handle `system.restart_required` event                            |
| UI comp  | `ui/src/components/layout/CurrentTimePill.tsx` (NEW) | Home time pill                                                    |
| UI comp  | `ui/src/components/layout/AppLayout.tsx`             | Mount CurrentTimePill, call `useTimezone.fetch()` at mount        |
| UI comp  | `ui/src/components/system/RestartToast.tsx` (NEW)    | Toast with "Restart now" button                                   |
| UI page  | `ui/src/pages/SettingsPage.tsx`                      | Display TZ in HomeSettingsSection, show RestartToast on save      |
| UI       | `ui/src/api.ts`                                      | `getSystemTimezone()`, `triggerSystemRestart()`                   |
| UI i18n  | `ui/src/i18n/locales/{en,fr}.json`                   | Timezone-related strings                                          |
| Infra    | `docker-compose.yml` (repo root)                     | Add commented TZ example                                          |
| Docs     | `README.md`                                          | Timezone section                                                  |
| Docs     | `docs/technical/architecture.md`                     | Update Timezone handling section (was partial)                    |
| Deps     | `package.json`                                       | Add `tz-lookup` dependency                                        |

## Why this design

- **Minimal backend code changes**: one new helper + reordering in `index.ts`. No refactor of 15+ call sites — all Date-using code benefits transparently
- **Zero-config for 90% of users**: they already set lat/lon for sunlight
- **Escape hatch**: `TZ` env var remains the ultimate override
- **Visible**: TZ displayed in Settings + live home time pill in every page header
- **Actionable**: "Restart now" button eliminates the SSH step when changing home location
- **Consistent with spec 060**: restart-via-helper reuses the same container pattern
- **Respects Node.js limitations**: TZ is set once at boot, documented restart requirement for changes
