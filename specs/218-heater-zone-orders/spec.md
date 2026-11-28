# Spec 218 — Heaters in zone orders

**Status**: Draft 2026-11-28. Follows spec 217, which left "zone orders for heaters" out.

## Context

A room with several electric heaters is driven heater by heater. Lights, shutters, awnings and
thermostats already have zone orders (one tap for the whole room, child zones included); heaters
have none. Since spec 217 a heater has one of two wirings: a relay (comfort / eco only) or a
pilot-wire module (up to six modes: comfort, comfort -1, comfort -2, eco, frost protection, off).

## Goals

1. One zone order puts every heater of a zone (and its child zones) in a chosen mode.
2. The same control, a flame button opening a menu of modes, on the Maison page command bar and
   in the dashboard's zone "Heating" widget.
3. A heater never receives an order the user did not ask for.

## Non-Goals

- Arbiter support, recipes, mode impacts (modes have no zone-order action today).
- Temperature regulation.
- Changing the single-heater controls of spec 217.

## Functional Requirements

### FR1 — Zone order `allHeatersMode` (backend)

`POST /api/v1/zones/:id/orders/allHeatersMode` with body `{ value: <mode> }`, the mode being one of
spec 217's six values. Any other value answers 400 and nothing is sent.

For each enabled `heater` of the zone subtree:

- **Pilot wiring**: if the mode is among the modes the module accepts, the order
  `set_pilot_wire_mode` is sent with that mode. Otherwise the heater is skipped.
- **Relay wiring**: `comfort` switches the relay OFF, `eco` switches it ON (same values as the
  single-heater toggle). Any other mode skips the heater: a relay is never moved to an approximation
  (maintainer's decision 2026-11-28).
- A heater without the needed order binding is skipped.

Skipped heaters count neither as executed nor as errors; the result keeps `{ executed, errors }`.

### FR2 — Modes offered for a zone (shared)

The modes offered for a zone are those at least one enabled heater of the subtree accepts, in the
contract order: a zone of relays only offers Comfort and Eco. The zone's **common mode** is the mode
all those heaters report when it is the same and known; otherwise none ("Mixed" in the UI).

### FR3 — Maison page command bar

When the zone subtree has a heater that accepts at least one mode, the command bar gets a third
group after lights and shutters: a flame button with a small chevron. A tap opens a menu titled
"All heaters" listing the offered modes, the common mode marked. Choosing a mode sends the order
and closes the menu; Escape or a tap outside closes it. The bar shows when the zone has lights,
shutters or such heaters.

### FR4 — Dashboard zone "Heating" widget

- The same flame button and menu, beside the temperature, when the zone has such heaters.
- Under the temperature, the common mode ("Comfort") or "Mixed".
- The thermostats' on/off button shows only when the zone has a thermostat (today it also shows
  in a heaters-only zone, where it does nothing). The setpoint stepper is unchanged.
- On a phone the widget's detail sheet carries the same: one 44 px button per offered mode under
  "All heaters", the common one marked, and the on/off button for thermostats only.

### FR5 — Button actions

The zone-order picker of button actions offers "Heater mode" when the chosen zone has heaters that
take a mode, with a select of the modes that zone offers (FR2) instead of the number field. Changing
the zone clears the chosen mode.

### FR6 — Labels

French and English. The menu reuses spec 217's mode labels.

## Acceptance Criteria

- [x] `allHeatersMode` with `eco` puts pilot heaters in eco and relay heaters relay ON
- [x] `allHeatersMode` with `frost_protection` moves pilot heaters that accept it, leaves relays and
      pilot heaters that do not accept it untouched
- [x] An unknown mode answers 400, nothing sent
- [x] Disabled heaters and child-zone heaters behave as for the other zone orders
- [x] Maison page and zone widget show the menu with the zone's offered modes, common mode marked
- [x] Relay-only zone: menu shows Comfort and Eco only
- [x] Heaters-only zone widget: no thermostat on/off button
- [x] Button action "All heaters: mode" works with a mode select

## Edge Cases

- Zone with heaters but none commandable (pilot heater with data but no order): no menu.
- Pilot heater whose mode is unknown: the zone has no common mode ("Mixed").
- A mode the API accepts but no heater of the zone takes: `{ executed: 0, errors: 0 }`.
- Several pilot-wire order bindings on one heater: the first is used (spec 217 rule).

## Docs Delta

| Page (EN and FR)                                  | Change                                        |
| ------------------------------------------------- | --------------------------------------------- |
| `docs/user/zones.md` + `.fr.md` (Zone orders)     | Row "All heaters: mode", relay rule           |
| `docs/user/dashboard.md` + `.fr.md` (Zone widget) | Heating row: heater mode menu                 |
| `docs/technical/data-model/zones.md` (EN only)    | `allHeatersMode` row in the zone orders table |
| `docs/technical/api-reference.md` + `.fr.md`      | Example key and the 400 on an unknown mode    |
| `docs/specs-index.md` + `.fr.md`                  | Index row                                     |

Screenshots to retake: none (no existing capture shows a heater zone).
