# Spec 190 — Door equipment type

**Status**: Implemented (2026-11-01)
**Depends on**: spec 115 (awning, the sibling-type pattern), spec 150 (gate)
**Prerequisite of**: spec 188 (order outcome), PR #1088 — the outcome tracking will default to on
for `gate` and `door`, off for every other type.

## Context

Sowel has two ways to model something that opens and closes:

- `gate`: driven by **one impulse** on a relay, which toggles the motor (open if closed, close if
  open, sometimes stop on the way). The state comes from a separate contact sensor.
- `shutter` (and its siblings `awning`, `pool_cover`): driven by **explicit orders** `OPEN` /
  `CLOSE` / `STOP`, with a position or an end state reported by the motor.

A motorised door driven by explicit orders — a LoRa chicken-coop door with limit switches, an io
garage door — has no type of its own. It is created as a `shutter`, so it inherits what a shutter
_is_: it counts in the zone's « n/total shutters », it obeys `allShuttersClose` (a « close all
shutters » at night closes the coop too), and it is listed and drawn among the shutters.

The awning had the same problem and spec 115 solved it with a sibling type that reuses the shutter
categories and only changes the nature. This spec does the same for doors.

A second gap stands in the way: **the type of an existing equipment cannot be changed from the UI**
(the edit form disables the field), so moving the coop to `door` would mean recreating it and losing
its history and the recipes that point at it. The API, on the other hand, accepts a type change
(the manager checks only that the new type exists), and specs 081 and 183 rely on it: a `switch`
turned `pool_pump` re-tags its bindings, an `ev_charger` turned `electric_vehicle` loses its energy
profile.

## Goals

1. A new equipment type `door`: a motorised door driven by `OPEN` / `CLOSE` / `STOP`, reporting an
   end state and/or a position.
2. Its own place everywhere a shutter has one: zone view group, zone aggregation and pill, Dashboard
   tile, detail page — never mixed with the shutters.
3. Change the type of an existing equipment between `shutter`, `awning` and `door`, keeping its id,
   bindings, history, recipes and dashboard widgets, from the edit form.

## Non-goals

- No new icon. The list icon is Lucide `DoorClosed` / `DoorOpen`; the Dashboard tile draws the
  existing garage-door picto by default, and the existing gate pictos can be picked.
- No zone-wide command (« close all doors ») and no per-zone Dashboard family widget for doors.
  A door is driven one at a time; a grouped closing is a recipe's job.
- No change to `gate`, `shutter`, `awning` or `pool_cover` behaviour, categories or aggregation.
- No new data or order category: a door reuses `shutter_move`, `set_shutter_position` and
  `shutter_position`, like the awning.
- No outcome tracking here (that is spec 188).
- No narrowing of the API: it keeps accepting a type change, which specs 081 and 183 depend on.
  Only the edit form is opened, and only within the cover family.

## Functional requirements

### FR1 — Type `door`

- `"door"` joins `EquipmentType` (backend and UI) and `VALID_EQUIPMENT_TYPES`.
- Display name: « Door » / « Porte ».
- It is candidate-based (`CANDIDATE_BASED_TYPES`) and builds its candidates exactly like `shutter`
  (same `shutter_*` key grouping and the same category-first fallback).

### FR2 — Bindings (the contract)

| Alias      | Kind  | Category               | Required | Meaning                                                    |
| ---------- | ----- | ---------------------- | -------- | ---------------------------------------------------------- |
| `state`    | order | `shutter_move`         | yes      | `OPEN` / `CLOSE` / `STOP` (STOP shown only if offered)     |
| `position` | order | `set_shutter_position` | no       | 0–100 (0 = closed, 100 = open)                             |
| `position` | data  | `shutter_position`     | no       | 0–100 (0 = closed, 100 = open)                             |
| `state`    | data  | any enum               | no       | end state: `OPEN`, `CLOSED`, `OPENING`, `CLOSING`, `FAULT` |

The end-state word binds automatically on a single-channel device: an enum speaking `CLOSED`,
`OPENING`, `CLOSING` or `FAULT` (words a command never uses), or, without an enum, the reading that
carries the move order's own key. It is bound under alias `state` whatever its device key (`door`,
`status`…). `RELEVANT_DATA.door` / `RELEVANT_ORDERS.door` feed the manual « add binding » list.

Mode impacts treat a door like a shutter (Open / Close / position).

### FR3 — Door state

One shared rule, used by the tile, the detail page, the zone row and the zone aggregation:

1. If a `state` data binding holds a string (case-insensitive): `CLOSED` → **closed**; `OPEN` →
   **open**; `OPENING` / `CLOSING` → **moving**; `FAULT` → **fault**; anything else → unknown.
2. Otherwise, if a position is known: `0` → **closed**, anything above → **open**.
3. Otherwise → **unknown**.

For counting, « open » means _not proven closed_: open, moving and fault all count as open; unknown
is not counted as open (it is counted in the total).

### FR4 — Controls and wording

- Three buttons: « Ouvrir » / « Stop » / « Fermer » (`controls.open` / `controls.stop` /
  `controls.close`, the shutter's vertical arrows). Stop follows the existing rule (shown unless the
  move order's enum omits `STOP`).
- A position slider **only when a position order is bound**, as for a shutter.
- A state pill, feminine in French: « Ouverte » / « Fermée » / « En mouvement » / « Défaut »
  (EN: Open / Closed / Moving / Fault). With a position but no state word, the pill follows the
  position (100 % → Ouverte, 0 % → Fermée, otherwise `n %`), like a shutter's.
- Same surfaces as a shutter: zone row (compact control), equipment card, detail page, Dashboard
  tile (desktop and mobile) and its detail sheet.

### FR5 — Zone

- A « Portes » / « Doors » group in the zone view, holding `door` equipments.
- `ZoneAggregatedData` gains `doorsOpen` and `doorsTotal`, counted over the zone and its descendants
  (FR3 rule). They are equipment-type based, independent from the existing `openDoors` (door
  _contact sensors_), and both stay.
- A zone pill (door icon + `n/total`, like the shutters pill) when `doorsTotal > 0`, highlighted
  when `doorsOpen > 0`.
- `doorsOpen` / `doorsTotal` are offered as zone sources to the publishers (`mapping-source.ts`).
- Doors are not in any `allShutters*` / `allAwnings*` zone command (those target their own types
  already).

### FR6 — Icons

- List / type icon: Lucide `DoorClosed` (open state: `DoorOpen`).
- Dashboard tile: the existing `GarageDoorIcon` picto, open or closed by FR3; the picker offers the
  existing `gate`, `sliding_gate` and `garage_door` pictos for a door too.
- Default Lucide icon for a door widget: `DoorOpen`.

### FR7 — Changing the type within the cover family

- The cover family is `shutter`, `awning`, `door` (`src/shared/equipment-type-change.ts`).
- Edit form: the type selector is enabled only when the equipment is in the cover family, and then
  lists only those three types; for every other type it stays disabled as today.
- The change goes through the existing `PUT /api/v1/equipments/:id`, which now declares `type` in its
  schema (it was accepted undeclared). The API rule does not change.
- The equipment keeps its id, bindings, history, recipes, dashboard widgets, `invertDirection`,
  `requireConfirmation` and timed command. An `equipment.updated` event is emitted as for any edit,
  so zone aggregation and the UI follow.

## Acceptance criteria

- [x] A `door` can be created from a device exposing `shutter_move` (and optionally a position and
      an end-state enum); its `state` order and data and its `position` bind automatically.
- [x] The door's tile, card, zone row and detail page show Ouvrir / Stop / Fermer and the FR3 state
      pill; a slider appears only with a position order.
- [x] A zone holding a closed and an open door shows « Portes 1/2 »; its shutter pill and shutter
      count are unchanged by the doors.
- [x] `allShuttersClose` on that zone does not send anything to the doors.
- [x] An existing `shutter` can be switched to `door` from its edit form; id, bindings, history and
      the recipes that reference it are unchanged.
- [x] The edit form of a light (or a gate) keeps its type selector locked; that of a shutter,
      awning or door offers exactly those three types.
- [x] EN and FR wording present; docs updated in both languages.

## Edge cases

- A door with neither a state word nor a position: pill hidden, counted in `doorsTotal`, never in
  `doorsOpen`.
- A state word in lower case (`closed`): matched case-insensitively.
- A disabled door: counted like a disabled shutter is today (the aggregator's existing rule).
- Switching a `shutter` with a per-zone « Volets » widget to `door`: the widget's own count drops
  it (it filters by type), the equipment widget keeps working.
- A recipe whose slot is restricted to `shutter` and holds an equipment switched to `door`: the
  recipe keeps running (slot constraints only filter the picker, the engine stores ids); the picker
  no longer offers it when the slot is edited. Documented as a caveat.
- An API client changing a type outside the cover family: unchanged behaviour (specs 081, 183).

## Docs delta

| Page (EN and FR)                                                   | Change                                                               |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `docs/user/equipments.md` + `.fr.md`                               | Door row and paragraph under Access; changing the type within covers |
| `docs/user/zones.md` + `.fr.md`                                    | Doors open/total in the aggregation table and the pill list          |
| `docs/technical/data-model/{equipments,zones}.md` (EN only, no FR) | `door` in `EquipmentType`; `doorsOpen` / `doorsTotal`                |
| `docs/technical/api-reference.md` + `.fr.md`                       | `PUT /equipments/:id` accepts `type`; zone aggregated fields         |

Screenshots to retake: none required (no existing screenshot shows the changed surfaces).
