-- Spec 188 O8 — the outcome of a guest's gate press, read from the gate state.
--
-- An `opened` row records that the press was sent. When the core can confirm
-- the impulse from the gate's own contact (state known at the press), the row
-- also carries what became of it: pending / confirmed / unconfirmed, and the
-- movement expected: open / close. NULL means the press was not tracked,
-- which is every row written before this migration and every press on a gate
-- whose state was unknown.
ALTER TABLE shared_access_journal ADD COLUMN outcome TEXT;
ALTER TABLE shared_access_journal ADD COLUMN outcome_expected TEXT;
