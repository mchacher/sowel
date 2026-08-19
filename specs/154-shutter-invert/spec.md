# Spec 154 — Per-equipment invert direction for shutter-family equipments

Issue: #614 ("Régler le problème du store banne — les commandes du store sont inversées dans sowel").

Amends spec 008 (shutters) and spec 115 (awnings).

## Problem

A shutter-family equipment (`shutter`, `awning`, `pool_cover`) can be bound to a
physical motor whose open/close direction is the reverse of what Sowel assumes.
Sowel maps the semantic move commands to a single fixed convention — for a
shutter `OPEN`/`CLOSE`, and for an awning Retract→`OPEN` / Extend→`CLOSE`
(identical RF verbs, only relabeled) — and, per spec 115, relies on the physical
**bridge** to invert the RF layer for motors wired the other way ("reading the
per-remote invert flag in Sowel" is a documented Non-Goal of spec 115).

When the bound device offers **no** bridge-side inversion (a Zigbee2MQTT cover
wired as an awning; a `somfyrts2mqtt` remote whose `invert` flag was never set),
every command is reversed and Sowel has no way to correct it. There is currently
no per-equipment invert option anywhere in Sowel.

## Goals

- Let a user flip a single shutter-family equipment's direction inside Sowel so
  that open/close, the position slider, the position pill, and the zone
  "deployed/open" aggregation all match the physical device.
- Work for **any** integration, not just bridges that expose an invert flag.
- Apply consistently across **every** command path: per-equipment UI controls,
  zone bulk commands (`allShutters*` / `allAwnings*`), recipes, and modes.
- Leave existing (non-inverted) equipments completely unaffected.

## Non-Goals

- Auto-detecting the correct direction. The flag is a manual, user-set opt-in.
- Removing or changing the bridge-side invert mechanism (spec 115). A user may
  correct direction either at the bridge or in Sowel; this adds the Sowel option.
- Inverting anything other than the shutter-family move + position semantics
  (no effect on other equipment types or order categories).

## Functional Requirements

- **FR1** — A boolean per-equipment field (`invertDirection`, default `false`)
  exists on every equipment. It is only meaningful for the shutter family
  (`shutter`, `awning`, `pool_cover`); it is ignored for all other types.
- **FR2** — Scope is **command-only** (the write path). With the flag on, the
  outgoing semantic order value is inverted before it is resolved to the device
  wire value:
  - `shutter_move` / `pool_cover_move`: `OPEN` ↔ `CLOSE`; `STOP` is unchanged.
  - `set_shutter_position` / `pool_cover_position`: value → `100 − value`.
  - Enforced at the single order choke point (`EquipmentManager.executeOrder`) so
    UI controls, zone bulk commands, recipes and modes all inherit it.
- **FR3** — The **read** path is intentionally NOT inverted. The reported
  `shutter_position` and the zone "deployed/open" aggregation keep the raw device
  value. Consequence: this is designed for **move-only** motors (the store-banne /
  RTS awning case) that report no position; on a position-reporting device the
  displayed position reflects the raw device state, not the flipped commands.
- **FR4** — The flag is editable from the equipment edit UI (a toggle), shown
  only for shutter-family equipment types.
- **FR5** — The flag round-trips through the equipment create/update API and is
  serialized on the equipment read model.
- **FR6** — Default off; a migration adds the column with default `0` so every
  existing equipment stays on the current behavior.

## UX

- In the equipment edit form, for a shutter/awning/pool_cover equipment, a toggle
  labeled e.g. "Invert open/close direction" ("Inverser le sens ouverture/fermeture")
  with a short helper: use it when the motor moves the opposite way to the
  controls.
- No new controls on the cards themselves — the existing open/close buttons,
  slider and pills keep their labels; only their effect (and the shown position)
  flips, because the inversion is applied in the backend.

## Edge Cases

- **STOP** is never inverted.
- A position value outside 0–100 is clamped by the existing resolver; `100 − v`
  keeps it in range for valid inputs.
- An equipment with the flag on but no position channel (move-only motor) simply
  inverts OPEN/CLOSE; there is no position order to invert.
- Toggling the flag does not move the motor or rewrite history; it only changes
  how subsequent commands are sent.
- Non-shutter-family types ignore the flag even if set (the write inversion only
  triggers for the shutter-family order categories).
- Command-only trade-off: on a device that DOES report position, the displayed
  position stays raw (not flipped). Accepted by design for the awning target.

## Acceptance criteria

- A shutter-family equipment with `invertDirection` on: pressing Open sends the
  device its Close command (and vice versa); `set_shutter_position` 30 sends 70.
- Zone bulk commands, a recipe action, and a mode impact driving that equipment
  all move it in the corrected direction (inherited via `executeOrder`).
- The reported position and zone aggregation are unchanged (raw) — command-only.
- Flag off (default) reproduces today's behavior byte-for-byte.
- A regression test fails before the fix (an inverted equipment sending the raw,
  non-inverted command).
