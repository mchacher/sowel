# Implementation Plan — Spec 061

## Strategy

Four slices, implemented in order, bundled in a single PR:

1. **A** — Core timezone detection + critical boot reordering
2. **B** — Restart via helper container (update-manager refactor)
3. **C** — UI: timezone store + CurrentTimePill + Settings display + RestartToast
4. **D** — Docs + docker-compose + README

All in one PR to keep the story coherent. Slice A is the risky one (boot reordering touches index.ts), the rest build on top.

---

## Slice A — Timezone detection + boot reordering

### A.1 — Add `tz-lookup` dependency

```bash
npm install tz-lookup
```

Verify package size after install:

```bash
du -sh node_modules/tz-lookup
```

Should be under 200 KB. If significantly larger, re-evaluate.

Types: `tz-lookup` ships its own `.d.ts`. If not, add `declare module "tz-lookup"` in `src/shared/types.ts`.

### A.2 — Create `src/core/timezone.ts`

Implements:

- `detectTimezone(opts): TimezoneResult` — pure function, returns `{ tz, source, diag }`, does NOT log (no logger available at call time)
- `probeTimezone(): { probe, offsetHours }` — runtime sanity check after setting `process.env.TZ`
- `readHomeCoordinatesRaw(db): { latitude, longitude }` — raw SQLite read (no SettingsManager needed)

Strict coordinate validation: `Number.isFinite`, `-90 ≤ lat ≤ 90`, `-180 ≤ lon ≤ 180`.

### A.3 — Make `openDatabase()` logger parameter optional

In `src/core/database.ts`, change signature from `openDatabase(path, logger)` to `openDatabase(path, logger?)`. Fall back to silent / console for log messages when logger is absent. Minor refactor.

### A.4 — Reorder `src/index.ts` boot sequence

```typescript
async function main() {
  const config = loadConfig();
  acquirePidLock(dataDir);

  // BEFORE logger — open DB + detect TZ
  const db = openDatabase(config.sqlite.path); // logger optional now
  const { latitude, longitude } = readHomeCoordinatesRaw(db);
  const tzResult = detectTimezone({
    latitude,
    longitude,
    tzEnv: process.env.TZ,
  });

  // ⚠️ CRITICAL: set BEFORE any new Date() call
  process.env.TZ = tzResult.tz;
  const probe = probeTimezone();

  // NOW create logger (uses correct TZ from here on)
  const logBuffer = new LogRingBuffer();
  const logHandle = createLogger(config.log.level, logBuffer);
  const logger = logHandle.logger;

  // Flush deferred diag
  for (const msg of tzResult.diag) {
    logger.info({ module: "timezone" }, msg);
  }
  logger.info(
    { module: "timezone", tz: tzResult.tz, source: tzResult.source, ...probe },
    "Timezone applied",
  );

  logger.info("Sowel — Founded by Marc Chachereau — AGPL-3.0");

  // Migrations (needs logger)
  runMigrations(db, migrationsDir, logger);

  // Rest of main() unchanged — but keep `tzResult` + `probe` accessible
  // to pass to ServerDeps for the /system/timezone endpoint
  const tzInfo = {
    tz: tzResult.tz,
    source: tzResult.source,
    offsetHours: probe.offsetHours,
  };

  // ... continue with settingsManager, managers, createServer({ ..., tzInfo })
}
```

### A.5 — Unit tests `src/core/timezone.test.ts`

- `detectTimezone({ tzEnv: "Europe/Paris", ...null })` → `{ tz: "Europe/Paris", source: "env" }`
- `detectTimezone({ latitude: 45.19, longitude: 5.72 })` → `{ tz: "Europe/Paris", source: "auto" }`
- `detectTimezone({})` → `{ tz: "UTC", source: "fallback" }`
- `detectTimezone({ latitude: 999, longitude: 5.72 })` → `{ tz: "UTC", source: "fallback" }` (out of range)
- `detectTimezone({ latitude: NaN, longitude: 5.72 })` → `{ tz: "UTC", source: "fallback" }`
- `detectTimezone({ tzEnv: "   ", latitude: 45.19, longitude: 5.72 })` → `{ tz: "Europe/Paris", source: "auto" }` (whitespace env → treated as unset)
- `detectTimezone({ tzEnv: "Europe/Paris", latitude: 40.7, longitude: -74 })` → `{ tz: "Europe/Paris", source: "env" }` (env wins over geo)
- Verify `diag` messages contain expected keywords

---

## Slice B — Restart via helper container

### B.1 — Refactor `UpdateManager` to share helper spawn logic

In `src/core/update-manager.ts`, extract a private helper:

```typescript
private async runHelperContainer(args: {
  name: string;
  cmd: string[];
  workingDir: string;
  env?: string[];
}): Promise<void> {
  // Pull docker:25-cli if needed, remove leftover container,
  // create + start with the given cmd + mounts, AutoRemove: true
}
```

Refactor existing `spawnHelper(targetVersion, ctx)` to call `runHelperContainer`, passing the pull+compose-up command.

### B.2 — New method `restartViaHelper()`

```typescript
async restartViaHelper(): Promise<void> {
  if (this.updating) throw new Error("Operation in progress");
  if (!this.isDockerAvailable()) throw new Error("Docker socket not available");
  const ctx = this.getComposeContext();
  if (!ctx) throw new Error("Not managed by docker compose");

  this.updating = true;
  try {
    this.emitProgress("spawning", "Spawning restart helper...");
    await this.runHelperContainer({
      name: "sowel-restarter",
      cmd: ["sh", "-c", `sleep 3 && docker compose up -d ${ctx.serviceName}`],
      workingDir: ctx.workingDir,
    });
    this.emitProgress("spawned", "Restart helper started");
  } catch (err) {
    this.updating = false;
    throw err;
  }
}
```

### B.3 — New route `POST /api/v1/system/restart`

In `src/api/routes/system.ts`:

- Admin only
- Checks Docker + compose managed
- Calls `updateManager.restartViaHelper()` detached
- Returns `{ success: true }`

### B.4 — New route `GET /api/v1/system/timezone`

In `src/api/routes/system.ts`:

- Any authenticated user (not admin-only — needed by FR7 pill)
- Returns `{ tz, source, offsetHours }` from the stored `tzInfo`

### B.5 — Settings change emits `system.restart_required`

- In `src/shared/types.ts`: add `{ type: "system.restart_required"; reason: string }` to `EngineEvent`
- In settings update handler (or `SettingsManager.setMany`): if `home.latitude` or `home.longitude` changed, log warn + emit event
- The existing WebSocket broadcast will route it to clients (topic `system`)

### B.6 — Tests for `UpdateManager.restartViaHelper()`

- Test: throws if not compose managed
- Test: throws if Docker unavailable
- Test: throws if already updating
- Test: spawns helper with correct command (mock dockerode)

---

## Slice C — UI

### C.1 — Zustand store `ui/src/store/useTimezone.ts`

Fetches `/api/v1/system/timezone` once on app mount. Provides `{ tz, source, offsetHours, loaded }`.

### C.2 — Component `ui/src/components/layout/CurrentTimePill.tsx`

- Clock icon + `HH:mm` in home TZ
- Uses `Intl.DateTimeFormat(undefined, { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false })`
- Refresh via `setInterval(..., 30_000)`
- Fallback to browser local if invalid TZ or store not loaded

### C.3 — Integrate pill in `AppLayout.tsx`

- Fetch timezone store at mount (add `useTimezone.getState().fetch()` to the existing `useEffect`)
- Render `<CurrentTimePill />` in the header, left of `<SunlightBanner>` (both mobile compact row and desktop row)

### C.4 — Settings page: display TZ in `HomeSettingsSection`

- Read `useTimezone` store
- Render the "Fuseau horaire" read-only row below lat/lon
- Source label: auto / env / fallback

### C.5 — Component `ui/src/components/system/RestartToast.tsx`

- Renders when triggered by the Settings save handler
- Message: "Home location changed. Sowel needs to restart for the timezone change to apply."
- Two buttons: `[ Restart now ]` / `[ Later ]`
- "Restart now" → `triggerSystemRestart()` + set `useWebSocket.updateInProgress = true` → existing `UpdateOverlay` takes over
- If API returns 400 (not compose), show fallback text with manual SSH instructions

### C.6 — Settings save detects location change

In `HomeSettingsSection.handleSave`:

```typescript
const didChangeLocation =
  parseFloat(latitude) !== parseFloat(initial.latitude) ||
  parseFloat(longitude) !== parseFloat(initial.longitude);

await updateSettings(toSave);

if (didChangeLocation) {
  setShowRestartToast(true);
}
```

### C.7 — UpdateOverlay: verify it handles restart case

Review `UpdateOverlay.tsx` — it currently triggers `window.location.reload()` on:

1. Version change (polled every 3s)
2. WebSocket reconnect after being disconnected

For a **restart** (same version, brief disconnect, reconnect), condition 2 handles it. Should work as-is. Add a test note to verify manually.

### C.8 — `ui/src/api.ts` additions

```typescript
export async function getSystemTimezone(): Promise<SystemTimezoneInfo>;
export async function triggerSystemRestart(): Promise<{ success: boolean; message: string }>;
```

### C.9 — i18n strings

French + English strings for:

- Timezone label and source descriptions
- Restart toast message and buttons
- Fallback warnings

### C.10 — `ui/src/store/useWebSocket.ts` — handle `system.restart_required`

Add case to the event handler — store it in state so Settings page can react (or just use it as a passive signal, since the toast is triggered locally by the save action anyway).

---

## Slice D — Docs + infra

### D.1 — `docker-compose.yml` (repo root)

Add commented `TZ` block with explanatory comment.

### D.2 — `README.md` timezone section

Short paragraph with the 3 priorities (env → geo → UTC) and note about restart required when changing location.

### D.3 — `docs/technical/architecture.md` — Timezone handling section

Update the existing "Timezone handling" section (currently describes the workaround). Replace with the full design: priority order, boot sequence, restart flow, Node cache caveat.

### D.4 — `docs/technical/deployment.md` — Troubleshooting update

Update the "Time-based logic broken" section to reference the new auto-detection and explain how to override via `TZ` env var.

### D.5 — Release notes draft in spec

Add a "Release notes" section in `specs/061-timezone-from-home-location/spec.md` with the user-facing message for v1.0.9.

### D.6 — Update `docs/specs-index.md`

Mark spec 061 as ✅ active once the PR is merged.

---

## Validation Plan

### Phase 4 — automated checks

```bash
npx tsc --noEmit
npx eslint src/ --ext .ts
npx vitest run
cd ui && npx tsc -b --noEmit && npx eslint .
```

### Phase 4 — manual tests on Mac (local Docker Desktop)

1. **Fresh install, no TZ, no lat/lon** → boot logs say "Timezone not configured: using UTC" + warn. Sunrise/sunset show UTC times.
2. **Set lat/lon to Grenoble (45.19, 5.72) via UI** → click "Restart now" → Sowel restarts → boot logs say "Europe/Paris (source: auto)" → sunrise/sunset show CEST times (07:00 / 20:17) → settings page shows "Europe/Paris — auto-détecté" → header pill shows home time.
3. **Set TZ=America/New_York in docker-compose** → restart via `docker compose up -d` → boot logs say "Europe/Paris" (env var priority)? NO wait — env says America/New_York, env wins. Boot logs say "America/New_York (source: env)". Sunrise/sunset adjust to NYC.
4. **Browser in different TZ than home** → use Chrome DevTools → Sensors → Timezone override to New York → refresh Sowel → header pill should still show home time (Europe/Paris), not NYC.
5. **Invalid lat/lon** (manually inject `999, 999` in DB) → detectTimezone falls back to UTC with warning.

### Phase 4 — production validation on sowelox

1. Deploy v1.0.9 via self-update UI (validates self-update still works)
2. Verify boot logs show `"Timezone set from TZ env var: Europe/Paris"` (workaround still active)
3. **Retire the workaround**: remove `TZ=Europe/Paris` from `/opt/sowel/docker-compose.yml` → `docker compose up -d`
4. Verify boot logs now show `"Timezone detected from home location: Europe/Paris (source: auto)"`
5. Verify sunrise/sunset, calendar slots, HP/HC tariff still correct
6. Verify the header pill displays the correct home time
7. Verify Settings → Home shows the TZ
8. Test Settings save → restart toast → "Restart now" button end-to-end

---

## Risks & Mitigations

| Risk                                                                                 | Mitigation                                                                                            |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `process.env.TZ` set too late, Node caches wrong TZ                                  | Reorder boot to set BEFORE logger creation. Probe verification in `probeTimezone()` catches misfires. |
| `openDatabase()` refactor breaks existing callers                                    | Logger parameter becomes optional, not removed. All existing calls still work.                        |
| `tz-lookup` returns wrong TZ for edge coordinates                                    | Fallback to UTC + warn log. User can override via TZ env var.                                         |
| Helper container fails to recreate sowel (restart)                                   | Same failure mode as spec 060 self-update. User falls back to manual `docker compose up -d`.          |
| Users who relied on TZ=UTC behavior                                                  | Release notes explain the change. Setting `TZ=UTC` in docker-compose restores old behavior.           |
| `UpdateOverlay` not triggered on restart (no version change)                         | The WS reconnect branch already handles this case. Add a manual test step.                            |
| Settings loaded twice (in `readHomeCoordinatesRaw()` and later by `SettingsManager`) | Only reads 2 keys, negligible cost. Acceptable.                                                       |
| Multi-user households on mobile in different TZs                                     | Home time pill shows home TZ consistently — correct for automation context.                           |

---

## Out of Scope

- Historical data re-classification (energy HP/HC in InfluxDB that was computed with wrong hours) — separate investigation
- Multi-TZ household — not applicable for home automation
- UI picker for timezone — the detected/env var TZ is displayed read-only in Settings
- Automatic migration of existing calendar slots — users naturally enter local time, the change is beneficial
