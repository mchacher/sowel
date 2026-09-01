-- Spec 174 — a timed action on an actuable equipment.
--
-- Nothing in the engine could say "act now, revert after N minutes". Every
-- instance of it was a recipe holding its own clock (motion-light,
-- state-trigger-light, delivery-gate), each with its own persistence and its
-- own cancellation rules — and the rules already differed between them.
--
-- What is stored here is NOT the action: that one is dispatched immediately
-- through executeOrder like any other. It is the REVERT the engine owes, and
-- the instant it is owed at. A gate open in the yard has to survive a restart
-- with something that still remembers to close it, which an in-memory
-- setTimeout does not.
--
-- One armed action per equipment (equipment_id is the primary key): a second
-- arm replaces the deadline rather than queueing behind it, because "open
-- again" from somebody looking at an open gate means "give me more time".
CREATE TABLE IF NOT EXISTS timed_actions (
  equipment_id  TEXT PRIMARY KEY REFERENCES equipments(id) ON DELETE CASCADE,
  alias         TEXT NOT NULL,
  -- JSON, so a boolean stays a boolean and an enum stays a string. NULL is a
  -- legitimate revert value (a gate impulse carries none), hence the JSON
  -- envelope rather than a bare TEXT column.
  action_value  TEXT NOT NULL,
  revert_value  TEXT NOT NULL,
  -- Epoch ms. A deadline that passed while the engine was down is honoured on
  -- the way back up, not dropped: that outage is the case the feature exists for.
  expires_at    INTEGER NOT NULL,
  armed_at      INTEGER NOT NULL,
  armed_by      TEXT
);

-- The rehydrate reads every row ordered by deadline at boot; the disarm and
-- the extend read by equipment, which the primary key already covers.
CREATE INDEX IF NOT EXISTS idx_timed_actions_expires ON timed_actions(expires_at);
