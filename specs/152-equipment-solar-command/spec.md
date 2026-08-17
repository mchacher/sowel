# Spec 152 — Equipment solar command channel

- **Status**: DRAFT
- **Date**: 2026-08-17
- **Related**: spec 135 (water heater equipment), spec 140 (energy capacity
  arbiter), spec 129 (metering-aware switch), spec 144 (Analyse mixed-state
  axis), spec 150 (unified binding candidates / on-off command)

## Context

A growing class of appliances can be driven from solar surplus through a
**second, dedicated control input that is distinct from their normal on/off**.
The reference case is an Atlantic Calypso Connecté water heater: it stays on
permanent mains (its own internal programming decides normal heating), and a
separate **dry-contact PV input** (wired here through a SONOFF MINI-ZBD) forces
the heat pump to run when a surplus signal is present. Closing that contact is
not "turn the heater on" — the heater is always powered — it is "heat now, on
solar".

Sowel already models the _normal_ on/off of a `water_heater` / `switch`
(spec 135: an order binding of category `light_toggle` / `toggle_power`, alias
`state`). It has **no place for this second, solar-specific actuator**. Today a
user would have to bind the MINI-ZBD as the equipment's main on/off, which
conflates "the heater is on" with "force heating on surplus" and makes a future
generic surplus recipe indistinguishable from a plain relay toggle.

## Goal

Give `water_heater` and `switch` equipments an optional **second on/off command
channel, "solar"**, with its own binding, its own state feedback, and its own
control on the cards — fully independent from the main on/off. This is the
actuator a future generic surplus recipe (out of scope here) drives through the
energy arbiter, while the appliance's normal on/off is never touched.

The user's mental model, verbatim: _"deux boutons, l'un on/off, et l'autre
solaire activé ou non"_ — the compact card shows the on/off toggle when a main
binding exists, and a solar toggle when a solar binding exists.

## Scope

### In scope

- New **`OrderCategory` `solar_toggle`** — a binary solar-force command channel,
  the on/off analog reserved for the solar actuator.
- New **`DataCategory` `solar_state`** — on/off state feedback for the solar
  channel, so its toggle reflects reality and it charts correctly. Classified in
  the spec 144 **states** family (stepped, semantic ticks), and **excluded from
  zone measurement/temperature aggregation** like every other actuator state.
- **Binding**: on `water_heater` and `switch`, the binding editor can assign any
  on/off device order (the same channels `isOnOffOrder` already recognises:
  Zigbee boolean `state`, Tasmota ON/OFF enum) to a **"Solaire"** role — order
  binding alias `solar` / category `solar_toggle`, and, when the device reports
  its state, a data binding alias `solar_state` / category `solar_state`. This
  is an **explicit** binding (never auto-guessed: nothing distinguishes a solar
  relay from a main relay at discovery).
- **Resolution**: the solar command resolves via
  `findOrderByCategory(orderBindings, ["solar_toggle"], ["solar"])` and its state
  via `findDataByCategory(dataBindings, ["solar_state"], ["solar_state"])`,
  mirroring the main on/off resolution. The two channels never collide.
- **Order execution**: `executeOrder(equipmentId, "solar", value)` dispatches
  only to the solar binding; the main on/off binding is untouched (and vice
  versa). Uses the existing `executeOrder` alias plumbing — no new route.
- **UI — two independent toggles**: the compact card
  (`CompactEquipmentCard`), the mobile widget (`MobileWidgetCard`) and the
  equipment detail page render the **main on/off** toggle iff a main binding
  exists and a **"Solaire"** toggle iff a solar binding exists. Each is driven by
  its own state. The Calypso case (solar-only) shows only the "Solaire" toggle.
  Solar control uses a sun (Lucide `Sun`) glyph. FR/EN i18n.
- **Types covered**: `water_heater` and `switch` only.
- Docs: `docs/user/equipments.{md,fr.md}`, `docs/technical/data-model.md`.

### Out of scope

- **The generic "surplus switch" recipe** that claims arbiter capacity and
  drives the `solar` command on grant/revoke — a separate follow-up shipped as
  an external recipe plugin (`sowel-recipe-dev`). This spec only makes the
  actuator and its surface exist; the recipe targets equipments of type
  `["switch", "water_heater"]` and dispatches alias `solar`.
- **Capability-typed recipe slots** ("any equipment exposing a solar command").
  Not needed: with a two-type scope the recipe uses the existing
  `constraints.equipmentType` list. Deferred until a third type wants in.
- **Arbiter changes**. The arbiter is unchanged (spec 140, phase 1: it issues no
  orders). A manual flip of the solar toggle is already seen by the arbiter as a
  manual override; a recipe-sourced solar order as recipe intent — existing FR-6
  behaviour, verified not re-implemented.
- **3-state / enum "mode" command** (Off / Auto / Force). The command is a plain
  boolean, decided with the user.
- **Solar channel on other types** (pool_pump, water_valve, heater, appliance).
  Extensible later by adding them to the candidate/UI lists; no model change
  required.
- **Setpoint / 62 °C awareness**. The appliance fixes its own PV setpoint; Sowel
  only opens/closes the contact.

## Data model

`OrderCategory` gains `solar_toggle`; `DataCategory` gains `solar_state` (both
TypeScript string unions plus their UI mirrors). One **SQLite migration (023)**
is required: `data_bindings.category_override` did not exist (only
`order_bindings` got it, in migration 006), and the solar _state_ binding needs a
distinct `solar_state` category to resolve, aggregate, and chart independently of
the main `light_state`. The migration is additive (nullable column, no backfill);
`order_bindings.category_override` already exists. A solar binding is then an
ordinary `order_bindings` / `data_bindings` row with alias `solar` /
`solar_state`. No new event type, no new API route (reuses
`POST /equipments/:id/orders/:alias` with alias `solar`).

## Acceptance criteria

- [x] AC1 — On a `water_heater` or `switch`, an on/off device order can be bound
      to a **"Solaire"** role (alias `solar`, category `solar_toggle`),
      independently of and without disturbing the main on/off binding.
      (equipment-manager.test.ts + binding-candidates.test.ts)
- [x] AC2 — `executeOrder(id, "solar", "ON"|"OFF")` dispatches only to the
      solar-bound device order; the main on/off channel is not actuated. The
      converse holds for `executeOrder(id, "state", …)`. (equipment-manager.test.ts)
- [x] AC3 — The compact card renders the main on/off toggle **iff** a main
      binding exists and the "Solaire" toggle **iff** a solar binding exists;
      both are independent. A solar-only equipment (Calypso) shows only
      "Solaire". (CompactEquipmentCard.tsx; visual)
- [x] AC4 — The mobile widget and the equipment detail page render the same two
      independent toggles. (EquipmentDetailPage.tsx, EquipmentCard.tsx,
      MobileWidgetCard.tsx + mobile-click-action.ts; visual)
- [x] AC5 — When a `solar_state` data binding exists, the "Solaire" toggle
      reflects it; `solar_state` is **not** pulled into the zone
      temperature/measurement aggregation. (zone-aggregator.test.ts)
- [x] AC6 — In Analyse, `solar_state` belongs to the **states** family: charted
      as a stepped line on the [0,1] state axis with `Arrêt`/`Marche` ticks, not
      as a smooth 0→1 measurement. (history-utils.test.ts)
- [~] AC7 — A solar order dispatched by a recipe (`source.kind = "recipe"`) is
  seen by the arbiter as recipe intent; a manual solar toggle
  (`source.kind = "manual"`) triggers the arbiter's manual-override
  suspension as any other manual order does. Relies on the **unchanged**
  arbiter order-source handling (spec 140, no code touched here); not
  separately tested, exercised end-to-end by the follow-up surplus recipe.
- [x] AC8 — No regression: equipments with no solar binding behave exactly as
      before; `switch` / `water_heater` without solar are unchanged; other
      equipment types are unaffected. (full backend 1481 + UI 489 suites green)
- [x] AC9 — FR/EN i18n for the solar control label and any tooltip. (reuses
      `equipments.group.solar`, `controls.turnOn/Off`, `common.on/off`)

## Edge cases

| Case                                             | Expected                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Solar order bound, no `solar_state` data         | Toggle still actuates; shows optimistic/last-command state, no crash               |
| Main on/off absent (Calypso, permanent mains)    | Only the "Solaire" toggle renders; no empty main control                           |
| Same physical relay bound as both main and solar | Allowed; both toggles act on it. Not recommended, not prevented (user intent)      |
| Solar device offline                             | "Solaire" toggle degraded/disabled per spec 116; equipment status reflects it      |
| Multi-gang relay                                 | Each on/off channel can be assigned to main or solar in the editor                 |
| `executeOrder(id, "solar", …)` with no binding   | Same "no matching binding" path as any unknown alias — explicit error, no dispatch |
| Existing pre-152 water_heater/switch             | No `solar` binding → identical behaviour; nothing new renders                      |
