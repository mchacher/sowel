-- Spec 178 — pressing again asks for longer, then gives up.
--
-- Spec 174 gave the engine one gesture: a second press extends the window by
-- the same configured duration, for ever. That answers "not yet" but never
-- "how much longer": getting an hour out of a gate configured at a quarter of
-- one takes four identical presses, and the control cannot say what the next
-- press will do because every press does the same thing.
--
-- An equipment can now declare a LADDER of window lengths, and a press walks
-- up it. This column is where the standing window remembers which rung it is
-- on — it has to survive a restart, or the climb would start over and a press
-- that should have given the deadline up would silently ask for more time
-- instead.
--
-- 0 for every existing row, and for ever on an equipment with no ladder: the
-- column is inert without one, and spec 174's rule 3 is untouched.
ALTER TABLE timed_actions ADD COLUMN step_index INTEGER NOT NULL DEFAULT 0;

-- How long the window was armed for. `armed_at` is when the WINDOW opened, not
-- when the current rung started, so it cannot answer "how long is this one" —
-- and that length is what re-places a window on a ladder edited under it
-- (FR-6). 0 on existing rows, which reads as "unknown length" and simply falls
-- back to the stored rung.
ALTER TABLE timed_actions ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0;
