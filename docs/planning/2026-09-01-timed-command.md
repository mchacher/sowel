# Timed command on an equipment

Draft agreed between the maintainer and Claude on 2026-09-01, ahead of submitting it on #875.
Supersedes the phasing written in issue #874 for everything that concerns the user-facing half.

## Principle

The engine sends a command, waits the configured duration, sends the revert command. The deadline
is a database row: it survives a restart, and one that passed during an outage fires on the way up.
One deadline per equipment; firing the same command again extends the window rather than opening a
second one.

## Eligibility

A timed command is offered only on an equipment that carries a state reading tied to that command.
An impulse gate with a reed contact qualifies. A blind relay does not.

Known and accepted: a reed only certifies "closed". A manual close that goes undetected during the
countdown means the deadline re-opens the gate.

## Configuration, on the equipment page

A "Timed command" panel, off by default, in the shape of the existing "Confirmation before action"
panel. Enabling it asks for the duration, the command and its revert command. Once enabled, the
timed command appears on the surfaces below.

## Use, two surfaces

- **Dashboard widget**: a timed tile can be pinned in addition to the ordinary tile.
- **Compact card**: the same command.
- While the window is open, both show the remaining time and allow cancelling, through one shared
  countdown component.

## Fix required on #875

- Drop the refusal of an action and a revert carrying the same value. On an impulse command they
  are the same command, and that is the primary use case.
- Replace it with a useful guard: refuse when the equipment does not carry the requested command,
  or carries no state reading tied to it.

## Behaviour

- A revert done by hand during the countdown, seen through the state reading, cancels the deadline.
- A revert that could not be sent raises an alarm. Never a blind replay.
- Deleting the equipment takes its deadline with it.
- Confirmation before action is the equipment's own (spec 146) and applies to the timed command too.

## Consequences

- One duration per equipment, so no "Gate 15 min" and "Gate 2 h" side by side. Putting the duration
  in the tile's configuration is what would buy that, and it was not retained.
- The delivery-gate recipe stops being needed. `motion-light` and `state-trigger-light` lean on the
  primitive instead of holding their own clock.
