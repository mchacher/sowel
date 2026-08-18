# Spec 153 — VMC (2-speed ventilation) equipment type

## Context

A 2-speed VMC (mechanical ventilation) is today modeled as two separate `switch`
equipments, one per speed relay. Every recipe that drives it has to juggle a
`main` + `boost` pair and re-implement the speed logic, and the physical safety
constraint of the motor (never energize both windings at once) is left to each
recipe or to the wiring.

Modeling a VMC as a single first-class equipment fits the guiding principle "an
Equipment is what's in the room": a VMC is one functional unit with a speed, not
two abstract switches. It also maps a 2-channel Zigbee relay (e.g. Sonoff MINI
DUO, endpoints `state_l1`/`state_l2`) to one equipment, and — crucially — lets
the **speed interlock live in the equipment**, where every caller (UI, recipe,
API) benefits from it.

Source issue: #573.

## Goals

1. A new `vmc` equipment type with three states **OFF / V1 / V2**.
2. Driven by up to two on/off relay order bindings: `low` (required) and `high`
   (optional). One relay bound = a plain on/off VMC; two = OFF/V1/V2.
3. A single logical `speed` order (`off`/`v1`/`v2`) whose decomposition into the
   two relays enforces the universal VMC safety rule.
4. Full equipment surface: creation/edit form, `Fan` icon, dashboard widget with
   an OFF/V1/V2 selector, compact card, zone list, detail-page control.
5. A computed `speed` data value usable by zones and recipes.

## Non-Goals

- Variable/proportional speed (0-100 %, 0-10 V, PWM). Only discrete OFF/V1/V2.
- More than two speeds.
- Migrating the community `vmc-humidity` recipe onto this type (tracked
  separately; the two-`switch` model keeps working).
- Auto-detecting VMC devices from integrations (a VMC is created by the user
  from relay equipment/candidates, like other relay-backed types).

## VMC wiring is universal and exclusive (safety)

All 2-speed VMCs are wired so a commutator sends the phase to **either** the
petite-vitesse (PV) **or** the grande-vitesse (GV) winding, never both.
Energizing both windings simultaneously can damage a motor not designed for it.
This is a hard safety invariant, not a preference. The equipment MUST enforce:

| State | `low` relay | `high` relay |
| ----- | ----------- | ------------ |
| OFF   | off         | off          |
| V1    | on          | off          |
| V2    | off         | on           |

- The two relays are **never** energized at the same time, including during a
  transition. Switching V1 <-> V2 is **break-before-make**: the current relay is
  turned off (and the OFF confirmed / dispatched first) before the target relay
  is turned on.
- A single-speed VMC (only `low` bound) exposes OFF / ON only; `high` and V2 are
  hidden.

## Functional Requirements

### FR1 — Type and bindings

`vmc` is a valid `EquipmentType`. Its binding candidates propose:

- order `low` — on/off, required (the PV / low-speed relay);
- order `high` — on/off, optional (the GV / high-speed relay);
- optional data `low`/`high` — boolean relay state feedback (e.g. `state_l1`/
  `state_l2`), used to derive the observed speed.

A 2-channel Zigbee relay auto-suggests both channels as `low` and `high`.

### FR2 — `speed` logical order and interlock

The equipment exposes a logical order `speed` with values `off`/`v1`/`v2`. It is
NOT a device binding: the backend VMC controller decomposes it into sequenced
on/off orders on the `low`/`high` bindings, enforcing the exclusive interlock
and break-before-make ordering (see architecture.md). `v2` is rejected when no
`high` binding exists.

### FR3 — Computed `speed` state

The equipment computes a `speed` value (`off`/`v1`/`v2`) from the observed relay
states when the relays report state, else from the last commanded speed. If both
relays are ever observed on (external miswiring/fault), `speed` reports `v2` and
a `warn` is logged — the equipment never itself commands both on.

### FR4 — UI surface

- Creation/edit form: `vmc` selectable in the type picker; `Fan` icon.
- Dashboard widget: an OFF/V1/V2 segmented selector (OFF/ON toggle when
  single-speed), reflecting the computed `speed`.
- Compact card and zone equipment list: `Fan` icon, tint, current speed, tap to
  cycle or toggle.
- Detail page: the same speed control.

## Acceptance Criteria

- [ ] `vmc` is accepted by `VALID_EQUIPMENT_TYPES` (create/update) and typed in
      `EquipmentType` (backend + UI copies).
- [ ] Binding candidates propose `low` (required) + `high` (optional); a
      2-channel relay auto-suggests both.
- [ ] A `speed` order of `v1`/`v2`/`off` drives the relays per the table above,
      and never leaves both relays on at any instant (break-before-make).
- [ ] `speed=v2` on a single-speed VMC (no `high`) is rejected with a clear error.
- [ ] Computed `speed` reflects observed relay state; both-on observed -> `v2` +
      warn.
- [ ] Form type picker shows `vmc` with `Fan` icon and localized label.
- [ ] Dashboard widget, compact card and detail page render the OFF/V1/V2
      selector (OFF/ON when single-speed) and issue `speed` orders.
- [ ] `defaultEnergyClassFor`/`defaultEnergyTimingsFor` return sensible defaults
      for `vmc`.
- [ ] i18n EN/FR complete; `locale-completeness.test.ts` green.
- [ ] Docs updated: data-model, user equipments page, specs-index, release notes.
- [ ] `npx tsc --noEmit`, `npx eslint src/`, `npx vitest run`, and UI typecheck +
      lint all pass.

## Edge Cases

- Only `low` bound (single-speed): V2 hidden; `speed` is `off`/`v1` only.
- Relays report no state feedback: `speed` derived from last command; UI still
  reflects the intended speed.
- Both relays observed on (external): report `v2`, log `warn`, never command both.
- Transition V1 -> V2 or V2 -> V1: break-before-make, at most one relay on at any
  time.
- A relay `executeOrder` fails mid-transition: log error, leave the equipment in
  the safe partial state (target relay not energized) rather than forcing both on.
- Equipment deleted / relay device offline: orders fail gracefully, logged.
