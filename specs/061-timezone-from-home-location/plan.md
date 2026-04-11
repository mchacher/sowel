# Implementation Plan — Spec 061

## Strategy

Tiny surgical change at the startup boundary. No refactor of existing time-using code. Three slices:

1. **A** — Core timezone detection module + integration in `index.ts`
2. **B** — Settings change notification (UI toast + WS event for restart hint)
3. **C** — Docker compose + README documentation

All in a single PR.

---

## Slice A — Timezone detection at startup

### A.1 — Add `tz-lookup` dependency

```bash
npm install tz-lookup
```

Also add types if needed (tz-lookup ships its own `.d.ts` or a simple ambient declaration may be needed).

### A.2 — Create `src/core/timezone.ts`

Implements `detectTimezone()` as described in architecture.md:

- Priority 1: `tzEnv` (from `process.env.TZ`)
- Priority 2: `tzLookup(latitude, longitude)`
- Priority 3: fallback `"UTC"` + warn log

Exports:

```typescript
export function detectTimezone(opts: DetectTimezoneOptions): string;
```

### A.3 — Integrate in `src/index.ts`

At the very top of `main()`, right after the database is opened and **before** any other manager is instantiated:

1. Create a temporary `SettingsManager` (already done in existing flow)
2. Read `home.latitude` and `home.longitude`
3. Call `detectTimezone({ latitude, longitude, tzEnv: process.env.TZ, logger })`
4. `process.env.TZ = detected`

### A.4 — Unit tests for `detectTimezone()`

- Test: when `tzEnv` is set → returns that value, doesn't call lookup
- Test: when `tzEnv` is empty/undefined + valid lat/lon → returns tz-lookup result
- Test: when lat/lon are both null → returns "UTC" + warn log
- Test: when lat/lon are out of range → returns "UTC" + warn log
- Test: when `tzEnv` is whitespace only → treated as unset

---

## Slice B — Settings change notification

### B.1 — Emit warn + event on home location change

In `settings-manager.ts` (or wherever `updateSettings` is handled), after the update transaction:

```typescript
if (changedKeys.includes("home.latitude") || changedKeys.includes("home.longitude")) {
  this.logger.warn("Home location changed. Restart Sowel for timezone changes to fully apply.");
}
```

### B.2 — UI toast after settings save

In `ui/src/pages/SettingsPage.tsx` `HomeSettingsSection`:

After successful save, if lat/lon changed compared to the initial values, show a toast:

> Home location saved. Restart Sowel for timezone changes to fully apply.

Use existing toast/notification pattern in the app. If no toast system exists, use a simple inline alert banner that disappears after 5s.

### B.3 — No-op for non-location settings

Other home settings (sunriseOffset, sunsetOffset, homeName) don't trigger the restart hint.

---

## Slice C — Documentation

### C.1 — Update repo `docker-compose.yml`

Add commented TZ example at the top of the `environment:` block:

```yaml
environment:
  # Timezone: by default, Sowel auto-derives from home.latitude/longitude in Settings.
  # To override explicitly (e.g., for no-geolocation setups), uncomment:
  # - TZ=Europe/Paris
  - INFLUX_URL=http://influxdb:8086
```

### C.2 — README section on timezone

Add a short section under "Configuration" or similar:

```markdown
## Timezone

Sowel auto-derives the timezone from the home location you set in Settings
(latitude/longitude). This affects:

- Sunrise/sunset display
- Calendar-based mode scheduling (via cron)
- HP/HC energy tariff classification
- Daily/monthly energy aggregation boundaries
- Notification timestamps

If you don't set a home location, or want to override the auto-detection,
set the `TZ` environment variable in `docker-compose.yml`:

    environment:
      - TZ=Europe/Paris

Note: changes to home location require a Sowel restart to take effect.
```

### C.3 — Update `docs/technical/architecture.md`

Add a section "Timezone handling" explaining the priority order (env var → geo → UTC) and the restart-required caveat.

### C.4 — Update CLAUDE.md if relevant

Add a note in the implementation conventions that native `Date` methods are intentionally used throughout the codebase and rely on `process.env.TZ` being set correctly at startup (via the timezone detection module).

---

## Validation Plan

### Phase 4 — automated checks

```bash
npx tsc --noEmit
npx eslint src/ --ext .ts
npx vitest run
cd ui && npx tsc -b --noEmit && npx eslint .
```

### Phase 4 — manual test plan

1. **Unit tests** for `detectTimezone()` — as listed in A.4
2. **Local integration test** on Mac:
   - Fresh Sowel install, no TZ env var, no lat/lon → verify log says "using UTC" + warning
   - Set lat/lon to Grenoble (45.19, 5.72) via UI → restart → verify log says "Europe/Paris" and sunrise/sunset are correct (07:xx / 20:xx in April)
   - Set TZ=America/New_York in docker-compose → restart → verify log says "TZ env var" and sunrise/sunset are in EDT
3. **Production validation** on sowelox (after release):
   - Remove the hardcoded `TZ=Europe/Paris` from `/opt/sowel/docker-compose.yml` (the workaround)
   - Upgrade to the new version via self-update (validates the feature end-to-end)
   - Verify sunrise/sunset still 07:xx / 20:xx (auto-derived from Grenoble lat/lon)
   - Verify calendar slots still fire at correct local times
   - Verify energy HP/HC classification still works

---

## Risks & Mitigations

| Risk                                                                         | Mitigation                                                                                           |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `tz-lookup` returns wrong TZ for edge coordinates                            | Fallback to UTC + warn log. User can override via TZ env var.                                        |
| Node.js TZ cache prevents runtime changes                                    | Documented restart requirement. UI toast makes it visible.                                           |
| Other Node versions or Alpine image behave differently                       | Pin Node 20 LTS (already done). Test in Docker during CI.                                            |
| Settings loaded twice (in `detectTimezone()` and later by `SettingsManager`) | Only reads 2 keys, negligible cost. OR pass the already-loaded settingsManager into the detect call. |
| Users who relied on the UTC behavior (unlikely but possible)                 | Breaking change noted in release notes. Explicit `TZ=UTC` in docker-compose restores old behavior.   |

---

## Out of Scope

- Historical data re-classification (energy HP/HC in InfluxDB that was computed with wrong hours) — separate investigation
- Multi-TZ household — not applicable for home automation
- UI picker for timezone — the detected/env var TZ is displayed as read-only in Settings → Home
- Migration of existing calendar slots that were time-compensated by users — manual fix by user after spec deployed
