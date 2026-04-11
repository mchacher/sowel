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

## Non-Goals

- Per-user timezones (household members in different TZs) — Sowel is single-household
- Migration of existing InfluxDB historical energy data that may have been classified with wrong HP/HC — tracked separately as needed
- Changing how dates are stored (SQLite already stores UTC ISO strings, InfluxDB stores UTC nanoseconds — no change)
- Changing the log timestamps (pino `isoTime` outputs absolute UTC ISO — no change)
- User-facing TZ selector in the UI — the derived TZ is just displayed, not selected

## Functional Requirements

### FR1 — Auto-derive timezone from home coordinates

- At Sowel startup, read `home.latitude` and `home.longitude` from settings
- If both are set, call `tz-lookup` (or similar library) to derive the IANA timezone name (e.g., `Europe/Paris`, `America/New_York`)
- Set `process.env.TZ` to the derived value **before** any module that uses `Date` methods, crons, or suncalc is initialized
- Log the detected timezone at INFO level: `"Timezone detected from home location: Europe/Paris"`

### FR2 — Manual override via `TZ` env var

- If `TZ` is already set in the environment at startup (e.g., via `docker-compose.yml` or host env), Sowel **respects it** and does NOT override it
- Log at INFO level: `"Timezone set from TZ env var: Europe/Paris (overriding auto-detection)"`

### FR3 — Fallback to UTC with warning

- If neither `TZ` env var is set NOR `home.latitude`/`home.longitude` are configured, fall back to UTC
- Log at WARN level with actionable message: `"Timezone not configured: using UTC. Set home.latitude/home.longitude in Settings or TZ env var in docker-compose.yml for correct local time."`

### FR4 — Re-derive on settings change

- If the user updates `home.latitude` / `home.longitude` in the UI while Sowel is running, the new TZ must take effect
- Since `process.env.TZ` is read by Node at startup and cannot be reliably changed at runtime (Date.prototype.getHours uses the cached TZ), we emit a NOTICE to the user: **restart required after home location change**
- UI shows a toast after saving: "Home location saved. Restart Sowel for timezone changes to fully apply."

### FR5 — Repo `docker-compose.yml` documentation

- Update the shipped `docker-compose.yml` at the repo root to include a commented-out `TZ` environment variable with an example:

  ```yaml
  services:
    sowel:
      environment:
        # Optional: override timezone. By default, Sowel auto-derives the
        # timezone from home.latitude/home.longitude in Settings.
        # - TZ=Europe/Paris
  ```

- Add a section in the README about timezone configuration

### FR6 — Existing backend code remains functional

- No changes to `sunlight-manager.ts`, `calendar-manager.ts`, `energy-aggregator.ts`, `tariff-classifier.ts`, etc.
- These modules continue to use `Date` methods — they now get the right TZ "for free" because `process.env.TZ` was set before they were instantiated

## Acceptance Criteria

- [ ] FR1: On a fresh Sowel deployment with `home.latitude=45.1885, home.longitude=5.7245` (Grenoble) and no `TZ` env var, sunrise/sunset display as CEST (e.g., 07:00 / 20:17 in April), not UTC
- [ ] FR2: When `TZ=America/New_York` is set in docker-compose, Sowel ignores home.latitude/longitude TZ derivation and uses America/New_York
- [ ] FR3: When no home location and no TZ env var, backend logs a WARN and uses UTC (status quo for new installations)
- [ ] FR4: After changing lat/lon in Settings, a toast asks the user to restart. After restart, new TZ is applied.
- [ ] FR5: Repo `docker-compose.yml` includes commented `TZ` example with explanatory comment
- [ ] FR6: Calendar cron slots fire at the correct local time (not UTC)
- [ ] FR6: HP/HC tariff classifier uses local hours
- [ ] FR6: Energy aggregator day boundaries use local midnight
- [ ] New tests added for the `detectTimezone()` helper covering: (a) TZ env var priority, (b) lat/lon lookup, (c) fallback to UTC with warning
- [ ] Documentation updated: `docs/technical/architecture.md` mentions the timezone handling strategy

## Edge Cases

- **Invalid lat/lon** (e.g., `999.0`) → `tz-lookup` throws or returns null → fall back to UTC with warning
- **Remote/polar coordinates** where tz-lookup has no clear answer → same fallback
- **User deploys on a server with system TZ already set** (e.g., Raspberry Pi with `timedatectl set-timezone Europe/Paris`) → `process.env.TZ` inherited from system → no override needed, Sowel respects it (FR2 branch)
- **User updates lat/lon during runtime** → no live effect on `Date` methods (limitation), requires restart (FR4 notice)
- **Multi-user household with user timezones differing from home** → out of scope, home TZ is used for all automation logic (which is the right behavior for home automation)

## Dependencies

- Add `tz-lookup` or `geo-tz` to backend package.json. Preference: `tz-lookup` — small (~100KB including data), synchronous, zero dependencies.

## Notes

The root cause of this issue is that Docker images use UTC by default and the codebase uses native `Date` methods that depend on `process.env.TZ`. This spec addresses the symptom cleanly at the boundary (one env var set early at boot) without touching the 15+ places in the code that use `getHours()`, `getDate()`, etc. — all of them benefit transparently.

Long-term, if Sowel ever gains multi-location support (e.g., vacation homes), the approach would need to be revisited — but that's beyond the scope of single-household automation.
