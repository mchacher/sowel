# Spec 217 — Pilot-wire modes on the electric heater

**Status**: Draft 2026-11-25.

## Context

Sowel's `heater` equipment knows one wiring: an on/off relay on the pilot wire, relay ON = eco,
relay OFF = comfort. Pilot-wire modules (NodOn SIN-4-FP-20/21 and FPS-4-1-00, the ADEO/Equation
variant, the Legrand cable outlet) carry the full order instead: comfort, comfort -1, comfort -2,
eco, frost protection, off. Zigbee2MQTT exposes it as the enum `pilot_wire_mode`.

Sowel receives that point today, as an uncategorised one no heater surface reads. Worse, these
modules also expose an on/off `state`, which the heater binds and reads with the relay convention:
a module switched off would be shown as « Comfort ».

## Goals

1. One equipment type, `heater`, for both wirings. The bound points decide which one applies.
2. The six modes readable and commandable wherever a heater is shown.
3. A strict boundary: the equipment knows no vendor vocabulary, the plugin knows no equipment.

## Non-Goals

- No new equipment type, plugin, table, endpoint or event.
- The `presence-heater` recipe (its own repository): a later version will use the modes.
- Zone orders for heaters, and arbiter support for pilot modes.
- Temperature regulation: the setpoint stays on the radiator.

## Boundary

| Concern                                                        | Owner              |
| -------------------------------------------------------------- | ------------------ |
| The modes Sowel knows, their categories, alias and meaning     | Sowel              |
| Which wiring a heater has, and which point then commands it    | Sowel              |
| Relay ON = eco (a property of the diode wiring, not of Zigbee) | Sowel              |
| Labels, icons, controls                                        | Sowel              |
| Recognising the Z2M expose `pilot_wire_mode`                   | zigbee2mqtt plugin |
| Translating Z2M values to Sowel's and back (`comfort_-1`)      | zigbee2mqtt plugin |
| MQTT topics and payloads                                       | zigbee2mqtt plugin |

Sowel's code contains no `comfort_-1` and no brand. The plugin contains no « heater ».

## Functional Requirements

### FR1 — Contract (Sowel)

A contract module declares data category `pilot_wire_mode`, order category `set_pilot_wire_mode`,
the alias `pilot_wire_mode` for both, and the closed vocabulary `comfort`, `comfort_minus_1`,
`comfort_minus_2`, `eco`, `frost_protection`, `off`. A module may support a subset: the order's
`enumValues` say which.

### FR2 — One state for both wirings (Sowel)

A single resolver answers, for a heater: its wiring, its mode (or unknown) and the modes it accepts.

- A `pilot_wire_mode` data or `set_pilot_wire_mode` order bound: wiring `pilot`. `state` is ignored.
- Otherwise: wiring `relay`, exactly today's behaviour, missing state read as comfort included. _Amended by #1331: a relay with no reading is now unknown, never comfort._
- In `pilot` wiring, a missing or unknown value is unknown: never shown as comfort.
- A heater runs when its mode is `comfort`, `comfort_minus_1` or `comfort_minus_2`.

Every heater surface reads this resolver; none reads the relay on its own.

### FR3 — Binding (Sowel)

A device with a pilot-wire point binds as a heater: the mode (data and order) and `power`,
`energy`, `voltage`, `current` when present. Its `state`, `power_on_behavior` and probes are not
bound automatically, from the UI or from the API. Without a pilot-wire point, binding is unchanged.

Not binding `state` also makes `presence-heater` v1 refuse such a heater ("no state order") rather
than drive it backwards. An existing heater picks the points up through its missing-bindings panel.
Its old `state` binding, if any, stays and is ignored by Sowel's surfaces; the docs say to remove it,
since a recipe could still command it.

### FR4 — Controls (Sowel)

- Equipment page and detail sheet: one button per accepted mode, the current one marked.
- Dashboard tile, phone card and Maison row: current mode as a badge. A tap on a pilot tile opens
  the detail sheet instead of toggling, since six modes have no opposite. The Maison row offers a
  compact mode selector.
- Relay heaters keep their Comfort / Eco toggle.
- Labels in French and English; a disabled equipment offers no command.
- The zone heating widget counts a heater as warm when it runs. This also corrects relay heaters,
  which it counted as warm in eco. The widget's on/off button commands thermostats and keeps
  reading thermostats only.

### FR5 — Zigbee2MQTT plugin

An enum expose `pilot_wire_mode` is declared with FR1's categories and translated `enumValues`;
incoming values and outgoing orders are translated; a value with no translation is passed through,
so an unknown mode shows as unknown. `state` keeps its category: the Legrand outlet can be used as
a plain switch when its pilot wire is off.

## Acceptance Criteria

- [x] A relay heater looks and behaves as before, except in the zone widget
- [x] A pilot heater shows its mode on every heater surface and offers only its declared modes
- [x] `state` ON/OFF never changes what a pilot heater shows
- [x] Creating one from UI or API binds the mode and metering, not `state`
- [x] A metering pilot heater joins the energy breakdown as a submeter
- [x] The plugin translates the six values both ways
- [x] No Z2M value or brand in `src/` or `ui/src/` runtime code; no equipment type in the plugin
- [ ] Checked on a real module (after the plugin release, owner's decision 2026-11-25)

## Edge Cases

- New core with old plugin: the point is `generic`; the heater stays a relay one. Create the
  equipment after both updates.
- New plugin with old core: allowed. The categories are ignored, the heater stays a relay one.
  Requiring an unreleased core would block every Zigbee2MQTT install until it ships.
- Data bound without order: mode shown, no control. Order bound without data: controls, mode unknown.
- Radiator that ignores some orders: the module still reports the mode it sends. Documented, with
  the external-programming setting some radiators need.
- The device choice is per device: a pilot module plus a separate plug on one heater still binds the
  plug's `state`, ignored by Sowel but commandable by a recipe.
- The engine does not check an enum order's value against `enumValues` (unchanged): an API call may
  send a mode the module does not declare.
- Several pilot modules on one heater: the first binding is read and commanded.

## Unknowns to check on hardware

- What `state` ON/OFF does to the mode, and the mode after a power cut. Neither is documented;
  neither changes this design.

## Docs Delta

| Page (EN and FR)                                    | Change                              |
| --------------------------------------------------- | ----------------------------------- |
| `docs/user/equipments.md` + `.fr.md`                | Heater: two wirings, modes, caveats |
| `docs/user/dashboard.md` + `.fr.md`                 | Pilot heater tile opens its sheet   |
| `docs/technical/data-model/equipments.md` (EN only) | Heater contract, categories         |
| `docs/technical/plugin-development.md` + `.fr.md`   | Publishing a pilot-wire module      |
| `docs/specs-index.md` + `.fr.md`                    | Index row                           |

Screenshots to retake: none (no existing capture shows a pilot heater).
