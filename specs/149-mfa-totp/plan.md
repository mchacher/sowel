# Implementation Plan — Spec 149 (TOTP MFA + Backup Codes)

## Slices

### Slice A — Data model + core MFA service (no routes yet)

- A.1 — `migrations/018_mfa_totp.sql`: `user_mfa_totp`, `user_mfa_backup_codes`, `mfa_trusted_devices`
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
