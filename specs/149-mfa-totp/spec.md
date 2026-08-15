# Spec 149 — Two-Factor Authentication (TOTP + Backup Codes)

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

- [ ] A user can enroll TOTP: setup → scan QR → confirm code → receive 10 backup codes.
- [ ] A user with MFA enabled cannot obtain full tokens from `/auth/login` alone — `/auth/mfa/verify` with a valid code is required.
- [ ] A wrong TOTP/backup code at `/auth/mfa/verify` is rejected and logged (`mfa.verify.failure`); the endpoint is rate-limited like `/auth/login`.
- [ ] A backup code can be used exactly once; a second use is rejected.
- [ ] Regenerating backup codes invalidates the previous set and requires password + a valid code.
- [ ] Trusting a device at login lets a later login from that device skip the MFA step until the trust expires (per-user configurable duration, default 30 days) or is revoked.
- [ ] A user can change their trusted-device duration preference (1-90 days) from Settings; the change applies only to devices trusted afterward.
- [ ] Changing the account password revokes all of that account's trusted devices.
- [ ] Disabling MFA requires password + a valid code and removes TOTP secret, backup codes, and trusted devices.
- [ ] An admin can force-disable MFA on a standard user's account from the UI.
- [ ] `scripts/auth/reset-mfa.mjs <username>` clears MFA state for a locked-out admin with no other admin available.
- [ ] Every MFA lifecycle event appears in `GET /api/v1/audit`.
- [ ] A user without MFA enabled sees zero behavior change at login.

## Edge Cases

- Enrollment started but never confirmed: the pending secret is silently replaced the next time setup is called (no orphaned partial state, no way to end up "half enrolled").
- All backup codes exhausted and TOTP device lost: FR6 (admin reset) or FR7 (CLI) is the recovery path — no email/SMS fallback exists in this spec.
- Trusted-device token stolen: it only skips the _second factor at login_; it does not grant enough trust to disable MFA or regenerate backup codes, which always re-check password + a live code regardless of session/device trust.
- Clock drift between server and authenticator app: verification accepts one 30-second step of drift on either side (standard TOTP tolerance).
- Standard user (non-admin) tries to reset another user's MFA: rejected — FR6 is admin-only, enforced by the existing role gate (spec 131).
