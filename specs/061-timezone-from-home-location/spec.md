# Spec 061 — Timezone auto-derived from home location

## Context

On 2026-04-11, the user reported that sunrise/sunset times displayed on the production UI were wrong (5:00 / 18:17 instead of 7:00 / 20:17 local in Grenoble). Investigation revealed that Docker containers default to UTC timezone, and the Sowel backend relies on native `Date` methods (`getHours()`, `getDate()`, etc.) which return the system-local time.

**This is not just a UI display bug** — it affects core automation logic:

| Affected component                    | Current bug (TZ=UTC)                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `croner` calendar slots               | Fire at specified time in UTC, not user's local time → modes activated 2h off   |
| `tariff-classifier.ts` HP/HC          | HP/HC classification uses UTC hours → wrong tariff assignment for 2 windows/day |
| `energy-aggregator.ts` day boundaries | "Today midnight" is 00:00 UTC (= 02:00 CEST) → day energy totals shifted        |
| `sunlight-manager.ts` display         | Sunrise/sunset displayed as UTC times                                           |
| `sunlight-manager.ts` isDaylight      | Based on `now >= sunriseOffset` in UTC → daylight window off                    |
| Notifications timestamps              | Shows UTC hour in messages                                                      |

A temporary workaround was applied on the user's production box (sowelox) by setting `TZ=Europe/Paris` in the deployment `docker-compose.yml`. This unblocks the immediate issue, but:

- Hardcoded per-deployment — not portable for users in other timezones
- Requires manual edit of `docker-compose.yml`
- Users in America/Australia/Asia need to remember to set it
- Not discoverable — a new user deploying Sowel has no indication of the issue

## Goals

1. Make Sowel **timezone-aware by default**, using the user's home location as the source of truth
2. **Zero configuration** for users who already set `home.latitude` / `home.longitude` in settings
3. Allow manual override via `TZ` env var for edge cases (users without geolocation, deployments on machines that already set system TZ)
4. **Update the shipped `docker-compose.yml`** to document the `TZ` override pattern without hardcoding a specific value
5. Ensure all time-based backend logic (crons, tariff classifier, energy aggregator, sunlight manager, notifications) uses the right TZ
6. **Make the timezone visible and actionable from the UI** — display it in Settings, show home time live in the header banner, offer a one-click restart when home location changes

## Non-Goals

- Per-user timezones (household members in different TZs) — Sowel is single-household
- Migration of existing InfluxDB historical energy data that may have been classified with wrong HP/HC — tracked separately as needed
- Changing how dates are stored (SQLite already stores UTC ISO strings, InfluxDB stores UTC nanoseconds — no change)
- Changing the log timestamps (pino `isoTime` outputs absolute UTC ISO — no change)
- User-facing TZ selector in the UI — the derived TZ is displayed read-only, not selectable
- Migration of existing calendar slots — users naturally enter local home time; the new behavior will simply match their intent for the first time. A release note mentions the switch.

## Functional Requirements

### FR1 — Auto-derive timezone from home coordinates

- At Sowel startup, **before creating the logger or any manager**, read `home.latitude` and `home.longitude` from the settings DB (via a raw SQLite read, since the full `SettingsManager` cannot exist yet)
- If both are set, call `tz-lookup` to derive the IANA timezone name (e.g., `Europe/Paris`, `America/New_York`)
- Set `process.env.TZ` to the derived value **before** any `new Date()` or `createLogger()` call
- Once the logger is created, log the detection at INFO level with source attribution

### FR2 — Manual override via `TZ` env var

- If `TZ` is already set in the environment at startup (via `docker-compose.yml`, host env, `timedatectl`, etc.), Sowel **respects it** and does NOT override it
- Log at INFO level: `"Timezone set from TZ env var: Europe/Paris (overriding auto-detection)"`

### FR3 — Fallback to UTC with warning

- If neither `TZ` env var is set NOR `home.latitude`/`home.longitude` are configured, fall back to UTC
- Log at WARN level with actionable message: `"Timezone not configured: using UTC. Set home.latitude/home.longitude in Settings or TZ env var in docker-compose.yml for correct local time."`

### FR4 — Sanity check after setting `process.env.TZ`

- Immediately after setting `process.env.TZ = detected`, perform a probe:
  - `const probe = new Date().toString()` — should include the timezone abbreviation (e.g. "CEST", "EDT")
  - `const actualOffset = -new Date().getTimezoneOffset() / 60` — expected hours offset
- Log the probe result at INFO level: `{ tz, probe, offsetHours } "Timezone applied"`
- If the offset does NOT match what the TZ should give (impossible unless bug), log ERROR

### FR5 — Settings change → "Restart now" button (instead of manual SSH)

- When the user updates `home.latitude` / `home.longitude` in the UI:
  - The backend logs a WARN: `"Home location changed. Restart Sowel for timezone changes to apply."`
  - The backend emits `system.restart_required` on the EventBus (new event type)
- The UI receives the event via WebSocket and displays a toast/banner:
  > Home location saved. Sowel needs to restart for the timezone change to apply.
  > [ Restart now ] [ Later ]
- Clicking **"Restart now"** calls `POST /api/v1/system/restart` which:
  - Spawns a temporary `docker:25-cli` helper container (reusing the spec 060 pattern)
  - Command: `sleep 3 && docker compose up -d <service>`
  - Returns immediately; the helper recreates the container
- The existing `UpdateOverlay` component handles the reload — reuse it
- Requires `isComposeManaged()` to be true, otherwise the button shows a tooltip to restart manually

### FR6 — Expose the detected timezone in the UI Settings

- New endpoint: `GET /api/v1/system/timezone` (admin)
  - Returns `{ tz: string, source: "env" | "auto" | "fallback", offsetHours: number }`
- In the Home Settings section (Settings → Home), display below the lat/lon fields:
  - **"Fuseau horaire"** label
  - Value: `Europe/Paris` (monospace badge)
  - Small tag showing source:
    - `auto` → "auto-derived from your coordinates"
    - `env` → "set via TZ environment variable"
    - `fallback` → "not configured, using UTC" (warning color)
- Read-only. Changes happen by editing lat/lon or the `TZ` env var.

### FR7 — "Current home time" pill in the header banner

- Add a new pill to the left of the existing sunrise/sunset pill in `SunlightBanner`
- Displays the current time **in the home timezone** (not the browser's local time — so when the user is traveling, they still see the home time)
- Format: `HH:mm` (e.g., `14:32`)
- Icon: Clock icon (Lucide `Clock`)
- Refresh every 30 seconds
- Implementation: uses `Intl.DateTimeFormat(undefined, { timeZone: detectedTz, hour: "2-digit", minute: "2-digit" }).format(new Date())` — the browser computes home time itself once given the TZ
- The TZ comes from `GET /api/v1/system/timezone`, cached in a Zustand store, refreshed at app mount

### FR8 — Repo `docker-compose.yml` documentation

- Update the shipped `docker-compose.yml` at the repo root to include a commented-out `TZ` environment variable with an example:

  ```yaml
  services:
    sowel:
      environment:
        # Optional: explicitly set the timezone. By default, Sowel auto-derives
        # the timezone from home.latitude/home.longitude configured in Settings.
        # Uncomment only if you need to override or if you don't set a home location.
        # - TZ=Europe/Paris
  ```

- Add a section in the README about timezone configuration

### FR9 — Existing backend code remains functional

- No changes to `sunlight-manager.ts`, `calendar-manager.ts`, `energy-aggregator.ts`, `tariff-classifier.ts`, `notification-publish-service.ts`, etc.
- These modules continue to use `Date` methods — they now get the right TZ "for free" because `process.env.TZ` was set before they were instantiated

## Acceptance Criteria

- [ ] FR1: On a fresh Sowel deployment with `home.latitude=45.1885, home.longitude=5.7245` (Grenoble) and no `TZ` env var, sunrise/sunset display as CEST (e.g., 07:00 / 20:17 in April), not UTC
- [ ] FR1: `detectTimezone()` runs BEFORE `createLogger()` in `src/index.ts` (verified by code inspection)
- [ ] FR2: When `TZ=America/New_York` is set in docker-compose, Sowel ignores home.latitude/longitude TZ derivation and uses America/New_York
- [ ] FR3: When no home location and no TZ env var, backend logs a WARN and uses UTC
- [ ] FR4: Backend logs `"Timezone applied"` with probe, offsetHours, tz fields immediately after setting TZ
- [ ] FR5: After changing lat/lon in Settings, a toast appears with "Restart now" button
- [ ] FR5: Clicking "Restart now" spawns a helper container and the UI reloads on the new process
- [ ] FR6: `GET /api/v1/system/timezone` returns `{ tz, source, offsetHours }`
- [ ] FR6: Home Settings section displays the current TZ with source label
- [ ] FR7: Header banner shows a pill with current home time, refreshed every 30s
- [ ] FR7: When the browser is in a different TZ than the home, the pill still shows home time (verified by setting browser TZ via DevTools)
- [ ] FR8: Repo `docker-compose.yml` includes commented `TZ` example with explanatory comment
- [ ] FR9: Calendar cron slots fire at the correct local time (not UTC)
- [ ] FR9: HP/HC tariff classifier uses local hours
- [ ] FR9: Energy aggregator day boundaries use local midnight
- [ ] New tests added for `detectTimezone()` covering: (a) TZ env var priority, (b) lat/lon lookup, (c) fallback to UTC with warning, (d) invalid coordinates
- [ ] Documentation updated: `docs/technical/architecture.md` mentions the timezone handling strategy (already partially done — to update with the final design)

## Edge Cases

- **Invalid lat/lon** (e.g., `999.0`, `NaN`) → `tz-lookup` throws → fall back to UTC with warning. `detectTimezone()` uses `Number.isFinite(x) && x >= -90/180 && x <= 90/180` checks.
- **Remote/polar coordinates** where tz-lookup has no clear answer → same fallback
- **User deploys on a server with system TZ already set** (e.g., Raspberry Pi with `timedatectl set-timezone Europe/Paris`) → `process.env.TZ` is undefined but Node reads the system TZ from `/etc/localtime`. In this case, the spec's detection logic still runs (no `TZ` env var → go to geo lookup). Should we respect the implicit system TZ instead? **Decision**: geo lookup is the canonical source for Sowel; if the user wants to force another TZ they set `TZ` explicitly. System TZ is too implicit.
- **User updates lat/lon during runtime** → FR5 handles this with toast + restart now button
- **Multi-user household with user timezones differing from home** → out of scope, home TZ is used for all automation logic
- **Docker not available for `POST /api/v1/system/restart`** → return 400 with clear error; toast shows manual restart instructions instead of the button

## Dependencies

- Add `tz-lookup` to backend `package.json`. Verify package size during install (expected ~100 KB including embedded data). If significantly larger than expected, evaluate `geo-tz` alternative.
- Requires `update-manager.ts` to expose a `restart()` method reusing the helper container pattern from spec 060

## Notes

The root cause is that Docker images use UTC by default and the codebase uses native `Date` methods that depend on `process.env.TZ`. This spec addresses the symptom cleanly at the boundary (one env var set early at boot) without touching the 15+ places in the code that use `getHours()`, `getDate()`, etc. — all of them benefit transparently.

Long-term, if Sowel ever gains multi-location support (e.g., vacation homes), the approach would need to be revisited — but that's beyond the scope of single-household automation.

### Release notes (v1.0.9 — to be drafted)

> **Timezone handling** — Sowel now auto-derives the correct timezone from your home location (Settings → Home). Calendar schedules, HP/HC tariff classification, sunrise/sunset display, and energy day boundaries now consistently use your local time. If you had manually compensated calendar slots for a UTC offset, you should reset them to the intended local time.
