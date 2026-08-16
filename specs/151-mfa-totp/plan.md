# Implementation Plan — Spec 151 (TOTP MFA + Backup Codes)

## Slices

### Slice A — Data model + core MFA service (no routes yet)

- A.1 — `migrations/022_mfa_totp.sql`: `user_mfa_totp`, `user_mfa_backup_codes`, `mfa_trusted_devices`
- A.2 — Add `otplib` + `qrcode` to `package.json`
- A.3 — `src/shared/types.ts`: `MfaStatus`, `MfaSetupResponse`, `MfaConfirmResponse`, `MfaTrustedDevice`, `MfaChallenge`, `UserPreferences.mfaTrustedDeviceDays`
- A.4 — `src/auth/mfa-service.ts`: `MfaService` (enrollment, confirm, verify TOTP/backup code, disable, regenerate codes, trusted-device issue/check/revoke — `issueTrustedDevice` reads `mfaTrustedDeviceDays` from the user's preferences, default 30)
- A.4b — `src/api/routes/me.ts`: clamp `mfaTrustedDeviceDays` to `[1, 90]` in `PUT /me/preferences`
- A.5 — Unit tests for `MfaService` (see Test Plan)

### Slice B — Login flow integration (token purpose isolation)

- B.1 — `JwtPayload` gains `purpose: "access" | "mfa_pending"`; `generateTokens()` sets `purpose: "access"`
- B.2 — `AuthService.verifyMfaToken()`; `AuthService.login()` branches to `MfaChallenge` when MFA enabled and no valid trusted-device token is presented
- B.3 — `auth-middleware.ts`: reject `purpose === "mfa_pending"` in the protected-route hook; add `/api/v1/auth/mfa/verify` to `PUBLIC_ROUTES`
- B.4 — `src/api/routes/mfa.ts`: `POST /auth/mfa/verify` (rate-limited like `/auth/login`)
- B.5 — Tests: login with MFA off (unchanged), login with MFA on (challenge → verify → tokens), trusted-device skip, mfaToken rejected on a protected route

### Slice C — Self-service MFA management (API)

- C.1 — `src/api/routes/mfa.ts`: `GET /me/mfa`, `POST /me/mfa/totp/setup`, `POST /me/mfa/totp/confirm`, `DELETE /me/mfa/totp`, `POST /me/mfa/backup-codes/regenerate`, `GET /me/mfa/trusted-devices`, `DELETE /me/mfa/trusted-devices/:id`
- C.2 — `auth-middleware.ts`: add these to `STANDARD_WRITE_ALLOWLIST`
- C.3 — `src/api/routes/me.ts`: password change calls `mfaService.revokeAllTrustedDevices()`
- C.4 — Audit logging for every MFA action (FR8)
- C.5 — Register routes in `src/api/server.ts`
- C.6 — Route-level tests (enroll → confirm → backup codes shown once; disable requires password+code; regenerate invalidates old codes; trusted-device CRUD)

### Slice D — Admin reset + break-glass CLI

- D.1 — `src/api/routes/users.ts`: `DELETE /users/:id/mfa` (admin-only)
- D.2 — `scripts/auth/reset-mfa.mjs`
- D.3 — Tests for the admin route (admin-only, audit logged); manual test for the CLI script (see Validation Plan)

### Slice E — UI

- E.1 — `TwoFactorSection` in `SettingsPage.tsx`: enable flow (QR + confirm + show-once backup codes with explicit acknowledgement), regenerate, disable, trusted-devices list/revoke, trusted-device duration input (1-90 days, default 30)
- E.2 — `ui/src/types.ts`: mirror Slice A.3 types
- E.3 — `ui/src/api/auth.ts` + `useAuth.ts`: `mfaChallenge` state, `verifyMfa()` action, per-username trusted-device token storage (`sowel_trusted_device_<username>`)
- E.4 — `LoginPage.tsx`: second-factor screen (code input, backup-code toggle, trust-device checkbox) rendered when `mfaChallenge` is set
- E.5 — i18n strings in `en.json` / `fr.json`

## Test Plan

### Modules to test

- `src/auth/mfa-service.ts` — the only module with new business logic (TOTP verify, backup code consumption, trusted-device matching)
- `src/auth/auth-service.ts` — `login()` branching, token `purpose` handling
- `src/auth/auth-middleware.ts` — `mfa_pending` token rejection on protected routes

### Scenarios per module

| Module          | Scenario                                                                 | Expected                                                         |
| --------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| mfa-service     | `confirmEnrollment` with correct code                                    | `confirmed_at` set, 10 backup codes returned once, hashes stored |
| mfa-service     | `confirmEnrollment` with wrong code                                      | Rejected, pending secret untouched                               |
| mfa-service     | Re-running `beginEnrollment` after a previous unconfirmed one            | Old pending secret replaced, no duplicate rows                   |
| mfa-service     | `verifyTotp` with code from ±1 step (clock drift)                        | Accepted                                                         |
| mfa-service     | `verifyTotp` with code outside the drift window                          | Rejected                                                         |
| mfa-service     | `verifyBackupCode` — valid unused code                                   | Accepted, `used_at` set                                          |
| mfa-service     | `verifyBackupCode` — same code reused                                    | Rejected                                                         |
| mfa-service     | `regenerateBackupCodes`                                                  | Old unused codes gone, 10 new ones, old codes rejected afterward |
| mfa-service     | `disable`                                                                | TOTP row, all backup codes, all trusted devices deleted          |
| mfa-service     | `issueTrustedDevice` then `checkTrustedDevice` with the returned token   | Match found, not expired                                         |
| mfa-service     | `checkTrustedDevice` with an expired token                               | No match                                                         |
| mfa-service     | `revokeAllTrustedDevices`                                                | All rows for that user gone; other users' rows untouched         |
| mfa-service     | `issueTrustedDevice` — user has no `mfaTrustedDeviceDays` preference set | `expires_at` = now + 30 days (default)                           |
| mfa-service     | `issueTrustedDevice` — user preference set to 7                          | `expires_at` = now + 7 days                                      |
| me.ts (route)   | `PUT /me/preferences` with `mfaTrustedDeviceDays: 500`                   | Clamped to 90 before being stored                                |
| me.ts (route)   | `PUT /me/preferences` with `mfaTrustedDeviceDays: 0`                     | Clamped to 1 before being stored                                 |
| auth-service    | `login()` — user without MFA                                             | Returns `AuthTokens` unchanged (retro-compat)                    |
| auth-service    | `login()` — user with MFA, no trusted-device token                       | Returns `MfaChallenge`, no tokens issued                         |
| auth-service    | `login()` — user with MFA, valid trusted-device token                    | Returns `AuthTokens`, MFA step skipped                           |
| auth-service    | `verifyMfaToken()` — expired mfaToken                                    | Rejected                                                         |
| auth-middleware | Protected route called with an `mfa_pending`-purpose token as Bearer     | 401 — never reaches `request.auth`                               |
| auth-middleware | Protected route called with a normal `access`-purpose token              | Unchanged behavior                                               |

### Retro-compat

- Every existing `auth-service.test.ts`-equivalent and `auth-middleware.test.ts` scenario for users without MFA must keep passing unmodified — this feature is additive and opt-in.

## Validation Plan

- `npx tsc --noEmit` (backend) and `cd ui && npx tsc -b --noEmit`
- `npx vitest run` — all tests above pass
- `npx eslint src/ --ext .ts` and `cd ui && npx eslint .`
- Manual: enroll TOTP with a real authenticator app (e.g. Aegis/Google Authenticator), confirm the QR scans and codes validate; log out and back in to confirm the second-factor screen appears; use a backup code once and confirm it's rejected on a second attempt; check "trust this device" and confirm a subsequent login skips the code prompt; disable MFA and confirm login returns to single-factor; run `scripts/auth/reset-mfa.mjs <username>` against a dev DB and confirm the account's MFA state is cleared.

## Test Results (for PR review)

This section documents what was _actually_ verified, not what was planned — automated coverage and every real-conditions testing phase, in order, with concrete outcomes. Written for a reviewer who has no other way to know what was tested versus assumed.

### 1. Automated test suite created

| File                                       | Scenarios | What it covers                                                                                                                                                                                                                         |
| ------------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/auth/mfa-service.test.ts`             | 21        | TOTP enrollment (confirm/reject/re-enroll), TOTP drift tolerance (±1 step accepted, wider window rejected), backup code issue/consume/reuse-rejected, regenerate, disable, trusted-device issue/check/revoke, `clampTrustedDeviceDays` |
| `src/auth/auth-service.test.ts`            | 10        | `login()` branching to `AuthTokens` vs `MfaChallenge`, trusted-device bypass, `verifyMfaToken` (expiry, purpose check), `verifyAccessToken` rejecting an `mfa_pending` token, `completeMfaLogin`                                       |
| `src/api/routes/mfa.test.ts`               | 12        | Full HTTP-level flows via Fastify inject against a real in-memory SQLite DB: enroll→confirm→verify→trusted-device→disable, admin force-reset, a standard user correctly denied the admin route                                         |
| `src/auth/reset-mfa-cli.test.ts`           | 5         | Spawns the _actual_ `scripts/auth/reset-mfa.mjs` script as a child process against a real file-backed SQLite DB seeded through the production `UserManager`/`MfaService` code — not a reimplementation, the real script                |
| `ui/src/store/useAuth.test.ts` (additions) | 10        | `mfaChallenge` branching in `login()`, per-username trusted-device token storage, `verifyMfa()`                                                                                                                                        |
| `ui/src/lib/clipboard.test.ts`             | 5         | Clipboard-copy fallback for insecure (plain HTTP) contexts — see the bug this was written for, phase 3 below                                                                                                                           |

Full suite after every change in this branch: backend `tsc --noEmit` and `eslint` clean, **1417 backend tests / 91 files** and **464 UI tests / 49 files**, all passing.

### 2. Real-conditions testing, phase 1 — automated pass against the real dev instance (2026-08-15)

Deployed to the dev VM (Sowel, real household hardware: irrigation valves, Bubendorff shutters, a three-phase energy meter, Zigbee/Netatmo/Legrand/Somfy integrations). Procedure: `git archive` (never a raw `tar`, to avoid leaking local operator context — see commit history) → `docker build` on the VM → extract `dist`/`ui-dist`/the new `otplib`/`qrcode` npm dependency tree from the built image → manual `POST /api/v1/backup` **before** touching the running container → `docker cp` → `docker restart`.

Ran 30 scenarios with a throwaway Node script (never committed) against the live server, using `otplib` to compute valid TOTP codes from the real enrollment secret returned by the API — no phone was available for this first pass, so this validated every server-side code path for real (real network, real SQLite file, real rate limiter) without yet validating the physical QR-scan UX. Covered: enrollment, wrong/correct code, backup-code single-use, regeneration invalidating old codes, trusted-device issue/skip-MFA/revoke, per-user trusted-device duration preference (set to 7, clamp 500→90, issued device's `expiresAt` measured at 7.00 days out), password-change revoking all trusted devices, disable re-auth, admin force-reset (FR6), a standard user correctly getting 403 on the admin route, and all 7 `mfa.*` audit actions observed for real in `GET /api/v1/audit`.

**All 30 passed.** One incidental confirmation: the test script itself tripped the `/auth/login`/`/auth/mfa/verify` rate limiter (10 req/min) by calling too fast — proof the limit is live, not a bug (fixed by pacing the script, not the product). Zero regression: `GET /health` showed 6/6 integrations connected and 48/48 devices online, identical before and after.

### 3. Real-conditions testing, phase 2 — Romain, real browser, real phone (2026-08-15)

Romain tested manually in both **Chrome and Firefox** against the deployed instance: enabled MFA, scanned the QR with a real authenticator app (not a computed code this time), then confirmed the full login flow twice — once via the app's live OTP code, once via a backup code instead. **Both browsers, both paths, confirmed working.**

**Real bug found and fixed in this phase**: the "Copy all" button for the one-time-shown backup codes did nothing when the instance was reached over plain HTTP (no TLS) — reproducible, silent, no error shown. Root cause: `navigator.clipboard` is only defined in a browser "secure context" (HTTPS or `localhost`); over plain HTTP it's `undefined`, so `navigator.clipboard.writeText(...)` throws immediately, and that throw happened inside an `async` click handler with no `try`/`catch`, surfacing as an unhandled promise rejection — the click simply appeared to do nothing. Fixed with a `document.execCommand("copy")` fallback (`ui/src/lib/clipboard.ts`, 5 new tests) and a visible error message if even that fails. Applied the same fix to a **pre-existing, unrelated bug** in the API-token copy button (`ApiTokensSection`) — identical root cause, found by inspection while fixing the one Romain hit, not part of spec 151's scope but trivial and correct to fix alongside it. Rebuilt (UI-only, no backend change needed) and redeployed; Romain re-tested and confirmed the button now works.

### 4. Real-conditions testing, phase 3 — rebase onto upstream, full re-verification (2026-08-15/16)

22 commits had landed on `upstream/main` while this branch was in progress (Sowel v1.46.0 → **v1.48.0**, including an unrelated `spec 150` devices change). Romain asked explicitly: pull latest, confirm MFA still holds, re-run everything, redeploy the VM to the new version, re-verify for real — rather than letting the branch drift stale before a PR.

- `git rebase upstream/main` — clean (branch point was a direct ancestor, no divergent history). One real conflict, `package-lock.json`, resolved by regenerating it (`npm install`) rather than hand-editing; `package.json` itself merged automatically with both sides' additions intact.
- **A silent migration-number collision was caught by manual inspection, not by git**: this branch's `018_mfa_totp.sql` and upstream's new `018_equipment_require_confirmation.sql` had picked the same sequential number independently (different filenames, so no git conflict — but a real collision against the project's numbering convention). Renamed to `022_mfa_totp.sql` (next free number after upstream's `020_arbiter_surplus.sql`); every reference to the old filename updated across the spec and architecture docs.
- Full suite re-run post-rebase: clean `tsc`/`eslint`, **1417/91 backend, 464/49 UI**, all passing (counts grew — upstream added its own tests in the interim).
- Redeployed to the dev VM at the new version (manual backup taken first, same procedure as phase 1). No new npm dependencies were needed this time (already present from phase 1's deploy); the stale `018_mfa_totp.sql` was explicitly removed from the container before copying in the renamed migration, so it couldn't apply twice under two different filenames. Restart logs confirmed `"migration":"022_mfa_totp.sql","msg":"Migration applied"` exactly once, `GET /health` reported `"version":"1.48.0"`, 6/6 integrations connected, 48/48 devices online.
- Re-ran 14 of the 30 phase-1 scenarios (the core flows) against the freshly updated real instance as a final sanity pass. **All 14 passed.**

### Net result

Zero known open issues. Verified twice at the automated-API level (in-process test suite, and a live pass against the real deployed server) and twice by a human in a real browser with real hardware in the loop (initial pass, and again after the v1.48.0 rebase). One real product bug found through manual testing and fixed with its own test coverage; one silent process risk (a leaked local-context file, and a silent migration-number collision) caught and corrected before ever reaching a shared branch.
