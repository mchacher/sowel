-- Issue #1305 — when the account's password last changed (epoch ms).
--
-- An access token is a signed JWT that stays valid until it expires, so
-- deleting refresh tokens alone left every other device in for up to 15 min
-- after a password change. The auth check refuses any token issued before
-- this instant. NULL = never changed through Sowel, nothing to refuse.
ALTER TABLE users ADD COLUMN password_changed_at INTEGER;
