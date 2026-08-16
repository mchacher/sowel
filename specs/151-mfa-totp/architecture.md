# Architecture — Spec 151 (TOTP MFA + Backup Codes)

## Flow diagram

```
Login (no trusted device, MFA enabled)
──────────────────────────────────────
Client                    POST /auth/login {username, password}
  │ ──────────────────────────────────────────────────────────▶ AuthService.login()
  │                                                              password OK, user has
  │                                                              confirmed TOTP row
  │ ◀────────────────────────────────────────────────────────── { mfaRequired: true, mfaToken }
  │
  │  user enters 6-digit code (or backup code), optional "trust this device"
  │
  │ ──────────────────────────────────────────────────────────▶ POST /auth/mfa/verify
  │                                                              { mfaToken, code, trustDevice }
  │                                                              verify mfaToken purpose+sig
  │                                                              verify TOTP window ±1 step
  │                                                              (or consume backup code)
  │ ◀────────────────────────────────────────────────────────── AuthTokens (+ trustedDeviceToken
  │                                                                if trustDevice was checked)

Login (trusted device present)
───────────────────────────────
Client ── POST /auth/login {username, password, trustedDeviceToken} ──▶ AuthService.login()
                                                                          password OK, token
                                                                          hash matches a live
                                                                          mfa_trusted_devices row
       ◀───────────────────────────────────────────────────────────── AuthTokens (MFA skipped)
```

## Token purpose isolation (security-critical)

`JwtPayload` gains a `purpose` field: `"access"` (today's tokens, implicit for anything signed before this spec) or `"mfa_pending"` (the short-lived token returned by `/auth/login` when a second factor is needed).

`AuthService.verifyAccessToken()` — used by the global `onRequest` auth hook for **every** protected route — rejects any token whose `purpose === "mfa_pending"`. Without this check, an `mfaToken` replayed as a normal `Authorization: Bearer` header would decode successfully (same secret) and grant partial API access before the second factor is ever checked, defeating the feature. `mfaToken` payload is `{ userId, purpose: "mfa_pending" }` — no `role`, so it must never reach `request.auth` through the normal path.

## Components

### New: `src/auth/mfa-service.ts`

`MfaService` — mirrors the shape of `AuthService`/`UserManager`. Owns:

- `beginEnrollment(userId)` → generates a TOTP secret (`otplib`), upserts an unconfirmed row in `user_mfa_totp`, returns `{ secret, otpauthUrl, qrCodeDataUrl }` (QR rendered via `qrcode`).
- `confirmEnrollment(userId, code)` → verifies code against the pending secret, sets `confirmed_at`, generates + hashes 10 backup codes, returns the plaintext codes (only time they exist unhashed).
- `verifyTotp(userId, code)` / `verifyBackupCode(userId, code)` → used both by `/auth/mfa/verify` and by the re-auth challenge on disable/regenerate.
- `disable(userId)` → deletes `user_mfa_totp` + `user_mfa_backup_codes` + `mfa_trusted_devices` rows for the user, in a transaction.
- `regenerateBackupCodes(userId)` → deletes unused codes, inserts a fresh 10.
- `isMfaEnabled(userId)` → `confirmed_at IS NOT NULL` on `user_mfa_totp`.
- `issueTrustedDevice(userId, userAgent)` / `checkTrustedDevice(userId, token)` / `revokeTrustedDevice(id, userId)` / `revokeAllTrustedDevices(userId)`.
  `issueTrustedDevice` reads the user's `preferences.mfaTrustedDeviceDays` (via `UserManager.getById`), falling back to `DEFAULT_TRUSTED_DEVICE_DAYS = 30` when unset, clamped to `[MIN_TRUSTED_DEVICE_DAYS = 1, MAX_TRUSTED_DEVICE_DAYS = 90]`, to compute `expires_at`. The clamp is enforced server-side regardless of what the client sends when saving the preference (see `me.ts` change below) — it's a stored user preference, not a request parameter, so a stale/tampered value can't push the expiry outside the allowed range.

### Changed: `src/auth/auth-service.ts`

- `login()` — after password verification, if `mfaService.isMfaEnabled(user.id)`, check for a valid `trustedDeviceToken` in the request; if absent/invalid, return an `{ mfaRequired: true, mfaToken }` shape instead of `generateTokens()`. Return type becomes `AuthTokens | MfaChallenge`.
- `generateTokens()` — access JWT payload gains `purpose: "access"`.
- New `verifyMfaToken(mfaToken)` → validates purpose + signature + expiry, returns `{ userId }`.
- `updatePassword` path (called from `me.ts` change-password route) now also calls `mfaService.revokeAllTrustedDevices(userId)`.

### Changed: `src/auth/auth-middleware.ts`

- `verifyAccessToken` callers reject `purpose === "mfa_pending"` (see above).
- `PUBLIC_ROUTES` gains `/api/v1/auth/mfa/verify` (authenticated via `mfaToken` in the body, not a bearer header).
- `STANDARD_WRITE_ALLOWLIST` gains the personal MFA-management routes (own account only): `POST /api/v1/me/mfa/totp/setup`, `POST /api/v1/me/mfa/totp/confirm`, `DELETE /api/v1/me/mfa/totp`, `POST /api/v1/me/mfa/backup-codes/regenerate`, `DELETE /api/v1/me/mfa/trusted-devices/:id`.

### New: `src/api/routes/mfa.ts`

Registers the `/api/v1/me/mfa/*` self-service routes and `/api/v1/auth/mfa/verify`. Admin-side reset (FR6) is added to the existing `src/api/routes/users.ts` as `DELETE /api/v1/users/:id/mfa` (admin-only, already covered by the default fail-closed mutation gate — no allowlist entry needed).

### New: `scripts/auth/reset-mfa.mjs`

Standalone Node script (no Fastify boot) opening `data/sowel.db` directly with `better-sqlite3`, deleting the three MFA tables' rows for the given username. Mirrors the existing `scripts/backfill-registry-sha256.mjs` style (small, dependency-light, run via `docker exec`).

### UI: `ui/src/pages/SettingsPage.tsx`

As of the `main` HEAD this branch is based on (commit e6983c9, "drop mobile QR login, move API tokens to Account tab"), Settings is tab-based (`SettingsTab = "general" | "account" | "energy" | "admin"`). The "account" tab body (line ~104-139) renders `ProfileSection`, `PreferencesSection`, `ChangePasswordSection`, `ApiTokensSection` in that order. New `TwoFactorSection` is added between `ChangePasswordSection` and `ApiTokensSection`. Sub-flows: enable (QR + confirm + show backup codes once), regenerate codes, disable, trusted-device duration input, list/revoke trusted devices — each re-auth-gated dialog reuses the existing password-prompt pattern from `ChangePasswordSection`.

(Note: `QrLoginPage.tsx` and `MobileSection` no longer exist as of that same commit — an earlier draft of this doc referenced `QrLoginPage.tsx` as an untouched neighbor; it's gone, not relevant to this spec either way.)

### UI: login flow

`ui/src/api/auth.ts` (`authLogin()`, wrapping `POST /auth/login`) and `ui/src/store/useAuth.ts` (`AuthState`) branch on `mfaRequired` in the response. `useAuth` gains: `mfaChallenge: MfaChallenge | null` state, and a `verifyMfa(code, { isBackupCode, trustDevice })` action that calls `POST /auth/mfa/verify`, then on success runs the same `saveTokens()` + `set({ user, isAuthenticated: true })` path `login()` uses today. `login()` itself no longer unconditionally calls `saveTokens()` — it does so only when the response is full `AuthTokens`; on `MfaChallenge` it sets `mfaChallenge` instead and returns without touching stored tokens. `ui/src/pages/LoginPage.tsx` renders a second screen when `mfaChallenge` is set: 6-digit code input, "use a backup code instead" toggle, "trust this device" checkbox (label shows the user's configured duration, default 30 days).

Trusted-device token storage: a new `sowel_trusted_device_<username>` localStorage key (keyed by username, not global — Sowel is a household app and a shared browser/tablet may see logins from multiple accounts, each with its own trust). `login()` reads it for the given username and includes it as `trustedDeviceToken` in the `/auth/login` call; `verifyMfa()` writes it when the server returns one (i.e. when `trustDevice` was checked).

## Data model

```sql
CREATE TABLE IF NOT EXISTS user_mfa_totp (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret TEXT NOT NULL,           -- base32 TOTP secret, cleartext (same trust
                                   -- boundary as existing integration creds in
                                   -- `settings` — no field-level encryption
                                   -- exists anywhere in Sowel today)
  confirmed_at DATETIME,          -- NULL = enrollment pending, not yet usable
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_mfa_backup_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,        -- sha256, same pattern as api_tokens.token_hash
  used_at DATETIME,               -- NULL = unused
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mfa_backup_codes_user ON user_mfa_backup_codes(user_id);

CREATE TABLE IF NOT EXISTS mfa_trusted_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,       -- sha256 of the opaque client-side token
  user_agent TEXT,                -- informational only, for the "revoke" UI list
  expires_at DATETIME NOT NULL,   -- created_at + user's mfaTrustedDeviceDays
                                   -- preference (default 30, clamped [1,90])
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mfa_trusted_devices_user ON mfa_trusted_devices(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_trusted_devices_hash ON mfa_trusted_devices(token_hash);
```

No columns are added to `users` — MFA status is derived by looking up `user_mfa_totp` by `user_id` (single indexed PK lookup, no join cost worth avoiding by denormalizing).

### `UserPreferences` addition (existing interface, `src/shared/types.ts`)

```ts
export interface UserPreferences {
  language: "fr" | "en";
  theme?: "light" | "dark" | "system";
  defaultZoneId?: string;
  /** Days a trusted device (FR4) stays valid once issued. 1-90, default 30
   *  when absent. Clamped server-side in the PUT /me/preferences handler —
   *  this is a stored preference, not a per-request parameter, so the clamp
   *  lives where the value is written, not in MfaService. */
  mfaTrustedDeviceDays?: number;
}
```

`PUT /api/v1/me/preferences` (existing route, `src/api/routes/me.ts`) clamps `mfaTrustedDeviceDays` to `[1, 90]` when present before calling `userManager.updatePreferences()` — no new route needed for this preference.

### `src/shared/types.ts` additions (mirrored manually in `ui/src/types.ts`, same dual-maintenance pattern as every other type today)

```ts
export interface MfaStatus {
  enabled: boolean;
  confirmedAt: string | null;
  backupCodesRemaining: number;
}

export interface MfaSetupResponse {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

export interface MfaConfirmResponse {
  backupCodes: string[];
}

export interface MfaTrustedDevice {
  id: string;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface MfaChallenge {
  mfaRequired: true;
  mfaToken: string;
}
```

## Event Bus

No new `EngineEvent` types. MFA is not part of the device/equipment reactive pipeline; the audit log (spec 113) already covers the security trail for auth changes, the same way login/logout are handled today (`auth.login.success`, `auth.login.failure`, `auth.logout` — this spec adds the `mfa.*` actions alongside them, no new event bus plumbing).

## New dependencies

| Package  | Why                                                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `otplib` | RFC 6238 TOTP secret generation, `otpauth://` URI building, code verification with drift window                                                |
| `qrcode` | Server-side QR PNG → data URL, so the enrollment screen needs no external request (CSP-friendly, matches the same-origin policy from spec 105) |

## Files changed

| Domain  | File                                                                          | Change                                                                                                      |
| ------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| db      | `migrations/022_mfa_totp.sql`                                                 | New: 3 tables (above)                                                                                       |
| auth    | `src/auth/mfa-service.ts`                                                     | New: `MfaService`                                                                                           |
| auth    | `src/auth/auth-service.ts`                                                    | `login()` branches on MFA; token `purpose` claim; `verifyMfaToken()`                                        |
| auth    | `src/auth/auth-middleware.ts`                                                 | Reject `mfa_pending` tokens on protected routes; new public route; allowlist additions                      |
| api     | `src/api/routes/mfa.ts`                                                       | New: `/me/mfa/*` + `/auth/mfa/verify`                                                                       |
| api     | `src/api/routes/users.ts`                                                     | Admin `DELETE /users/:id/mfa` (FR6)                                                                         |
| api     | `src/api/routes/me.ts`                                                        | Password change revokes trusted devices; clamp `mfaTrustedDeviceDays` to `[1, 90]` in `PUT /me/preferences` |
| api     | `src/api/server.ts`                                                           | Register `registerMfaRoutes`                                                                                |
| shared  | `src/shared/types.ts`                                                         | New MFA interfaces; `UserPreferences.mfaTrustedDeviceDays`                                                  |
| ui      | `ui/src/types.ts`                                                             | Mirror new MFA interfaces + `UserPreferences` field                                                         |
| ui      | `ui/src/pages/SettingsPage.tsx`                                               | New `TwoFactorSection` (includes the trusted-device duration input)                                         |
| ui      | `ui/src/api/auth.ts`, `ui/src/store/useAuth.ts`, `ui/src/pages/LoginPage.tsx` | Branch on `mfaRequired`, second-factor screen, trusted-device token storage                                 |
| scripts | `scripts/auth/reset-mfa.mjs`                                                  | New: break-glass CLI reset (FR7)                                                                            |
