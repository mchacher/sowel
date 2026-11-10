-- Spec 199 — push devices: a name per subscription and the last delivery result.
-- `label` NULL means the UI derives one from the user agent. The delivery
-- columns are written by the web-push channel on every send; a subscription
-- failing `consecutive_failures` times in a row is pruned (see web-push.ts).

ALTER TABLE push_subscriptions ADD COLUMN label TEXT;
ALTER TABLE push_subscriptions ADD COLUMN last_sent_at DATETIME;
ALTER TABLE push_subscriptions ADD COLUMN last_success_at DATETIME;
ALTER TABLE push_subscriptions ADD COLUMN last_error TEXT;
ALTER TABLE push_subscriptions ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
