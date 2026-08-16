# Spec 151 — Two-Factor Authentication (TOTP + Backup Codes)

## Context

Sowel authentication today is single-factor: username + bcrypt-hashed password (`src/auth/`). A compromised or guessed password is enough to reach a household's automation engine — device control, camera streams, energy data, plugin credentials. This spec adds an optional second factor per user, using the same TOTP standard as Google Authenticator / Aegis / 1Password, plus one-time backup codes for when the authenticator app is unavailable.

This is phase 1 of a two-phase MFA rollout. **WebAuthn/FIDO2** (security keys, Touch ID, Windows Hello) is deliberately out of scope here and will be a follow-up spec once TOTP ships and the login-flow plumbing (the `mfaRequired` step) it will reuse is proven. **Email-based password recovery** was considered and explicitly dropped — Sowel has no SMTP/email integration today, and adding one is a separate concern from MFA.

## Goals

1. A user can enable/disable TOTP MFA on their own account from Settings.
2. Login enforces the second factor when enabled, without changing the experience for users who don't opt in.
3. Losing the TOTP device doesn't lock a user out forever: backup codes, admin-assisted reset, and a CLI break-glass script all exist.
4. A user can mark a browser as trusted, for a duration they configure themselves (default 30 days), to skip the TOTP prompt on repeat logins from that browser.

## Non-Goals

- WebAuthn / FIDO2 (security keys, platform biometrics) — follow-up spec.
- Email-based password recovery — dropped, not being studied in this spec.
- SMS-based codes — not planned (SMS gateway is a new external dependency Sowel doesn't have and SMS OTP is considered weaker than TOTP).
- Mandatory/enforced MFA — this spec ships it opt-in only. A future spec could add an admin-enforced policy.

## Functional Requirements

### FR1 — TOTP enrollment

From Settings → a new "Two-Factor Authentication" section (next to the existing Change Password section), a user starts enrollment: the server generates a TOTP secret and returns it as an `otpauth://` URI plus a QR code (rendered server-side to a data URL — no external image request, consistent with the existing same-origin CSP from spec 105). The user scans it with an authenticator app and submits the current 6-digit code to confirm. Confirming an enrollment invalidates any previous unconfirmed enrollment for that user (re-scanning always starts clean).

### FR2 — Second factor at login

When a user with confirmed TOTP logs in with a correct password, `POST /api/v1/auth/login` returns `{ mfaRequired: true, mfaToken }` instead of full tokens. The client then calls `POST /api/v1/auth/mfa/verify` with the `mfaToken` and either a 6-digit TOTP code or a backup code. On success, full access/refresh tokens are issued exactly as today. `mfaToken` is a short-lived (5 min), single-purpose JWT that cannot be used to access any other API route (see architecture.md — token purpose isolation).

### FR3 — Backup codes

Confirming enrollment (FR1) generates 10 single-use backup codes, shown once in the UI (the user must acknowledge saving them before the dialog closes — only salted hashes are stored, exactly like passwords). Each code is consumed on first successful use. A user can regenerate a fresh set of 10 at any time (invalidating unused old ones) by re-authenticating with password + a valid TOTP/backup code. The UI warns when ≤ 2 unused codes remain.

### FR4 — Trusted devices

At the MFA verification step (FR2), the user may check "trust this browser". The trust duration is **per-user configurable** (Settings → Two-Factor Authentication → "Trusted device duration"), not a fixed value for everyone: a number of days between 1 and 90, defaulting to 30 for a user who hasn't set a preference. Changing the preference only affects trusted devices issued afterward — it does not retroactively shorten or extend already-issued trust. On success, the server issues an opaque trusted-device token (stored client-side the same way the existing access/refresh tokens are — no cookies) and only its hash server-side. On a later login, if the client presents a valid, non-expired trusted-device token for that user, the MFA step is skipped entirely. Users can view and revoke their trusted devices from Settings. Changing the account password revokes all trusted devices for that account (defense in depth — see architecture.md).

### FR5 — Disabling MFA

A user can disable TOTP MFA from Settings, which requires password + a valid TOTP/backup code (not just an active session) — this prevents a stolen/idle session from turning off protection. Disabling deletes the TOTP secret, all backup codes, and all trusted devices for that user.

### FR6 — Admin-assisted reset

An admin can force-disable MFA on any **other** user's account from Administration → Utilisateurs (no password/code challenge needed from the admin — this is the same trust level admins already have over other accounts, e.g. disabling a user). Logged to the audit trail.

### FR7 — Break-glass CLI reset

`scripts/auth/reset-mfa.mjs <username>`, run via `docker exec sowel node scripts/auth/reset-mfa.mjs <username>`, clears MFA state for that account directly in SQLite. Covers the case an admin locks themselves out with no other admin available to help via the UI. Requires host/container access, which is the same trust boundary already assumed by the existing `scripts/logs/fetch-logs.py` and backup-restore tooling.

### FR8 — Audit trail

Every MFA state change and verification attempt is recorded via the existing `AuditLogger` (spec 113): `mfa.enabled`, `mfa.disabled`, `mfa.disabled.by_admin`, `mfa.verify.success`, `mfa.verify.failure`, `mfa.backup_codes.regenerated`, `mfa.trusted_device.revoked`.

## Acceptance Criteria

Verified twice: by the automated test suite (1355 backend + 392 UI tests, `src/api/routes/mfa.test.ts` covers the HTTP layer end-to-end against a real in-memory DB) and, on 2026-08-15, against a real deployment on the dev VM (Sowel v1.46.0 + this branch hot-deployed) — 30/30 scenarios passed via a throwaway API-level test script (TOTP codes computed with `otplib` from the real enrollment secret, since scanning a QR code with a physical authenticator app requires a human with a phone — not done in that first pass, closed afterward, see below). Zero regression: 6/6 integrations connected, 48/48 devices online before and after.

- [x] A user can enroll TOTP: setup → scan QR → confirm code → receive 10 backup codes. (QR verified as a valid `data:image/png` — the scan step itself needs a human with a phone, not done)
- [x] A user with MFA enabled cannot obtain full tokens from `/auth/login` alone — `/auth/mfa/verify` with a valid code is required.
- [x] A wrong TOTP/backup code at `/auth/mfa/verify` is rejected and logged (`mfa.verify.failure`); the endpoint is rate-limited like `/auth/login`. (rate limit genuinely triggered by the real test script, confirming it's live)
- [x] A backup code can be used exactly once; a second use is rejected.
- [x] Regenerating backup codes invalidates the previous set and requires password + a valid code.
- [x] Trusting a device at login lets a later login from that device skip the MFA step until the trust expires (per-user configurable duration, default 30 days) or is revoked.
- [x] A user can change their trusted-device duration preference (1-90 days) from Settings; the change applies only to devices trusted afterward. (verified via `PUT /me/preferences` against the real server: set to 7, clamp-tested at 500→90, then a freshly-issued trusted device's `expiresAt` measured at 7.00 days out)
- [x] Changing the account password revokes all of that account's trusted devices.
- [x] Disabling MFA requires password + a valid code and removes TOTP secret, backup codes, and trusted devices.
- [x] An admin can force-disable MFA on a standard user's account from the UI. (route verified via API)
- [x] `scripts/auth/reset-mfa.mjs <username>` clears MFA state for a locked-out admin with no other admin available. (verified by spawning the actual script against a real file-backed SQLite DB, `src/auth/reset-mfa-cli.test.ts`; not additionally re-run on the dev VM itself)
- [x] Every MFA lifecycle event appears in `GET /api/v1/audit`. (all 7 `mfa.*` actions observed for real: `mfa.enabled`, `mfa.disabled`, `mfa.disabled.by_admin`, `mfa.verify.success`, `mfa.verify.failure`, `mfa.backup_codes.regenerated`, `mfa.trusted_device.revoked`)
- [x] A user without MFA enabled sees zero behavior change at login.

**Closed on 2026-08-15** (Romain, manual test on the dev VM, Chrome and Firefox): enrolled with a real authenticator app (QR scan), then confirmed login both ways — username + password + the app's live OTP code, and separately username + password + a backup code. Both browsers, both paths, confirmed working. One real bug found and fixed in the process: the "Copy all" backup codes button did nothing over plain HTTP (`navigator.clipboard` is unavailable outside a secure context) — fixed with an `execCommand` fallback (`ui/src/lib/clipboard.ts`), same fix applied to the pre-existing API token copy button. No remaining known gaps.

## Edge Cases

- Enrollment started but never confirmed: the pending secret is silently replaced the next time setup is called (no orphaned partial state, no way to end up "half enrolled").
- All backup codes exhausted and TOTP device lost: FR6 (admin reset) or FR7 (CLI) is the recovery path — no email/SMS fallback exists in this spec.
- Trusted-device token stolen: it only skips the _second factor at login_; it does not grant enough trust to disable MFA or regenerate backup codes, which always re-check password + a live code regardless of session/device trust.
- Clock drift between server and authenticator app: verification accepts one 30-second step of drift on either side (standard TOTP tolerance).
- Standard user (non-admin) tries to reset another user's MFA: rejected — FR6 is admin-only, enforced by the existing role gate (spec 131).
- **Deferred (flagged in PR #541 review, non-blocking)**: no anti-replay tracking of consumed TOTP codes. `verifyTotpCode` checks a code against the current step ± the drift tolerance above, but does not record the last successfully-used step per user, so the same valid code could in principle be accepted more than once within its ~30-90s validity window (e.g. captured by a shoulder-surfing observer or a compromised clipboard during that window). Standard mitigation is a `last_used_step` column on `user_mfa_totp`, checked and updated atomically inside `verifyTotp`, rejecting any code whose step is ≤ the stored value. Left out of this phase — no exploit reported, and backup codes (already single-use, FR3) cover the higher-value case of a fully compromised second factor. Tracked as a follow-up, not a blocker for this PR.
