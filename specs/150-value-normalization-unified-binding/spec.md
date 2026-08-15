# Spec 150 — Typed value normalization at ingestion + unified binding candidates

## Status

Implemented (2026-08-15) — see plan.md for the executed breakdown and recorded
decisions.

Release-note-worthy behavior change: LoRa reed values sent as strings (`"0"`)
previously derived gate state "closed"; after ingestion normalization they derive
"open" correctly (polarity fix).

## Context

A recurring class of "the device works in the integration but fails in Sowel" bugs traces
back to two structural gaps:

1. **No value normalization anywhere in the pipeline.** Integration plugins forward raw
   payloads (by design — they declare a schema at discovery and stay thin). The core
   stores `JSON.stringify(value)` with no coercion, and `equipment.data.changed`
   re-emits the raw value. A boolean-typed data point may therefore carry `true`,
   `"ON"`, `"on"`, `"true"`, `1` or `"1"` depending on the device and protocol. Every
   consumer re-guesses: there are four divergent coercers today
   (`order-wire-value.ts::coerceOnOff`, `sensorUtils.tsx::coerceBooleanish`,
   `zone-aggregator.ts::isBooleanActive/isContactOpen`,
   `history-writer.ts` inline boolean check), plus UI components that only test
   `value === true`. Any vocabulary a given consumer does not know is **silently**
   wrong: a motion sensor reporting `"true"` counts as inactive in zone aggregation, a
   thermostat power reading `"ON"` renders as off.

2. **`computeBindingCandidates` exists twice and diverged.** The complete
   implementation (`src/equipments/binding-candidates.ts`) is only exercised by its own
   tests; the runtime copy (`ui/src/lib/binding-candidates.ts`) implements 10 equipment
   types and returns `[]` for everything else. Confirmed active bug: `light_dimmable`
   and `light_color` are declared candidate-based in both UI lists
   (`DeviceSelector.tsx`, `bindingUtils.ts`) but have no case in the runtime copy, so a
   dimmable/color Zigbee light is filtered out as incompatible and auto-binding skips
   it. Tests pass because they test the other copy.

A third, concrete instance of the class: a Zigbee dry-contact relay (e.g. SONOFF
MINI-ZBD driving a garage door) cannot be bound as the command of a `gate` equipment.
The gate auto-binding path only accepts order keys `R1..R4` (LoRa), `command` and
`gate_trigger` (Somfy RTS); a Zigbee relay's order key is `state` (category
`light_toggle`), so the equipment is created with no actuating order — while the
device _appears_ compatible in the selector because its incidental `generic` exposes
pass the data-category filter.

History of the same class: #360/plugin#4 (boolean orders silently dropped by Z2M),
#315 (contact rendering), #309/#308 (candidates absent), #358/#357/#276/#278 (boolean
relays excluded from enum-only paths), specs 109/110 (hardcoded alias resolution).

## Goals

- **G1** — One shared value-normalization authority applied **once, at ingestion**
  (`DeviceManager.updateDeviceData`): values are coerced to the type the plugin
  declared at discovery, then stored and propagated normalized. Everything downstream
  (UI, zones, gate derivation, recipes, history, order confirmation) receives a stable
  JS type.
- **G2** — A canonical `CATEGORY_EXPECTED_TYPE` table so a category with boolean/number
  semantics that arrives with a mismatched declared type is flagged (warn log) at
  discovery instead of failing silently three layers downstream.
- **G3** — A single `computeBindingCandidates` implementation shared by backend and UI.
  The UI stops shipping a diverged subset; `light_dimmable`/`light_color` candidates
  work again.
- **G4** — `gate` equipments become candidate-based and accept an on/off relay
  (boolean or ON/OFF-enum order) as their `command`, protocol-agnostically (Zigbee
  relays, LoRa R1..R4, Somfy `gate_trigger` all become candidates of the same shape).

## Responsibility split (multi-protocol by design)

| Responsibility                                                                                                | Owner                                                    |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Parse protocol payloads, declare schema at discovery (`type`, `category`, `enumValues`, `valueOn`/`valueOff`) | Integration plugin                                       |
| Forward runtime values raw (no per-plugin coercion)                                                           | Integration plugin                                       |
| Coerce runtime values to the declared type, once, at ingestion                                                | **Core** (this spec)                                     |
| Validate category/type coherence at discovery                                                                 | **Core** (this spec)                                     |
| Resolve boolean orders to wire values at dispatch (`valueOn`/`valueOff`, spec #360)                           | Core (unchanged)                                         |
| Binding candidate computation                                                                                 | **Core-owned shared module** (this spec), consumed by UI |

No plugin changes and no plugin releases are required by this spec.

## Functional requirements

### F1 — Normalization authority

New `src/shared/value-normalization.ts` exporting `normalizeValue(value, type,
enumValues?)`. Rules:

| Declared type | Input                                                    | Result                                                                       |
| ------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| any           | `null` / `undefined`                                     | passed through unchanged (availability is handled elsewhere)                 |
| `boolean`     | boolean                                                  | unchanged                                                                    |
| `boolean`     | string `on`/`true`/`1` (trim + case-insensitive)         | `true`                                                                       |
| `boolean`     | string `off`/`false`/`0`                                 | `false`                                                                      |
| `boolean`     | number `1` / `0`                                         | `true` / `false`                                                             |
| `boolean`     | anything else (incl. `OPEN`/`CLOSED`/`DETECTED`)         | **kept raw + flagged** (polarity would be a semantic guess — see Exclusions) |
| `number`      | finite number                                            | unchanged                                                                    |
| `number`      | numeric string (`Number(trim)` finite)                   | parsed number                                                                |
| `number`      | anything else                                            | kept raw + flagged                                                           |
| `enum`        | string matching an `enumValues` entry case-insensitively | canonical casing from `enumValues`                                           |
| `enum`        | string with no `enumValues` declared                     | unchanged                                                                    |
| `enum`        | anything else                                            | kept raw + flagged                                                           |
| `text`        | string                                                   | unchanged                                                                    |
| `text`        | number / boolean                                         | `String(value)`                                                              |
| `json`        | anything                                                 | unchanged                                                                    |

### F2 — Applied at ingestion

`DeviceManager.updateDeviceData` normalizes each incoming key against the declared
`device_data` row (`type` + `enum_values`) **before** persisting and before emitting
`device.data.updated`. Keys with no declared row keep today's behavior (type inferred
from `typeof value`, normalization is a no-op).

### F3 — Failures are loud but harmless

When coercion is flagged (F1 "kept raw"), the raw value is stored/propagated as today
and a `logger.warn({ deviceId, key, declaredType, value }, "Value does not match
declared type")` is emitted **once per (deviceId, key) per process lifetime** (dedupe
set) to avoid log floods on chatty devices.

### F4 — Category/type coherence check

`src/shared/constants.ts` gains `CATEGORY_EXPECTED_TYPE: Partial<Record<DataCategory,
DataType>>` covering the semantic categories (boolean: `motion`, `contact_door`,
`contact_window`, `water_leak`, `smoke`, `light_state`, `camera_monitoring`…; number:
`temperature`, `humidity`, `power`, `energy`, `shutter_position`, `battery`…). At
discovery upsert, a declared type that contradicts the table logs a single warn per
(deviceId, key). No hard rejection — the table documents the contract and surfaces
drift, it does not gate.

### F5 — One `computeBindingCandidates`

The complete backend implementation moves to `src/shared/binding-candidates.ts`
(pure, dependency-free). The UI imports it (path alias); `ui/src/lib/
binding-candidates.ts` is deleted. All equipment types the backend copy already
handles (including `light_dimmable`, `light_color`, `sensor`, `thermostat`, `heater`,
`gate`, the `default` fallback) become available to the runtime UI.

### F6 — One `CANDIDATE_BASED_TYPES`

The shared module exports the single `CANDIDATE_BASED_TYPES` set; the two hand-synced
copies in `DeviceSelector.tsx` and `bindingUtils.ts` are replaced by the import.
`gate` is added to the set (F7).

### F7 — Gate accepts on/off relays

The shared `gate` candidate case produces:

- one candidate per **trigger-like order**: `isOnOffOrder(o)` (boolean
  `light_toggle`/`toggle_power`, or ON/OFF/TOGGLE enum), key in
  `R1..R4`/`command`/`gate_trigger`, or category `gate_trigger`. `orderKeys` = the
  order; `dataKeys` = the device's **gate feedback rows** (LoRa reed `RS*` keys,
  `contact_door`/`contact_window` categories) so a combined controller (LoRa board
  with R1 relay + RS reed) keeps feeding `deriveGateState`. The relay's own `state`
  feedback data is deliberately **not** bound: the gate's open/closed state is a
  virtual binding (alias `state`, category `gate_state`) and a `light_state` data
  binding would both collide with that alias and pollute the zone aggregator's
  lights-on count. Non-trigger writable config exposes (`power_on_behavior`,
  `turbo_mode`…) are NOT candidates.
- one **contact candidate** when the device has feedback rows but no trigger order
  (contact-only sensors like SNZB-04P, data-only reed boards). There is **no
  blanket "all data" fallback**: a device with neither a trigger order nor feedback
  rows yields zero gate candidates (a plain temperature sensor is not gate-compatible).

The `DeviceSelector` gate special-case filter is removed (candidates now cover Somfy,
LoRa, Zigbee relays and contact sensors). Alias resolution: a gate order of category
`light_toggle`/`toggle_power` is aliased `command` via the per-type
`TYPE_CATEGORY_ALIASES` override in `bindingUtils.ts` (GateControl only reacts to
`command`; the global category alias would have said `state`); LoRa `R1..R4` and
Somfy `gate_trigger` keep their existing `command` resolution. On dispatch,
`executeOrder` resolves an empty (null) value on a **boolean** binding to `true` —
the boolean twin of the existing "null → first enum value" rule — so GateControl's
momentary button actuates a Zigbee relay; the boolean then maps onto
`value_on`/`value_off` via the spec #360 machinery.

Known limitations (accepted):

- Every trigger candidate on a device attaches **all** of that device's feedback
  rows; a multi-gate board (R1+R2 with RS1+RS2) binds every reed to each gate and
  `deriveGateState` opens on ANY open reed. Same behavior as the legacy
  `generic`-category path — refine to `R<n>`↔`RS<n>` pairing if it ever bites.
- A contact sensor already bound to another equipment is filtered from the gate
  "compatible" list (free-candidate rule); "Show all" still allows binding it.

### F8 — Retro-compatibility

- Enum orders (Tasmota `power1` etc.) and the order dispatch path are untouched.
- Existing bindings are untouched; no migration. Stored raw values normalize lazily as
  devices refresh (next `updateDeviceData`).
- Downstream tolerant checks (`value === true || value === "ON"`) are left in place in
  this spec — they become redundant, not wrong. Their cleanup is a follow-up.
- History writer field types are unchanged: it already writes `value_string` +
  `value_number` per declared type. Normalization strictly widens what lands in
  `value_number` (e.g. numeric strings previously wrote no `value_number` at all).

## Explicit exclusions (non-goals)

- No coercion of polarity-ambiguous vocabularies (`OPEN`/`CLOSED`, `DETECTED`…) —
  flagged raw instead. A wrong polarity guess is worse than a visible warn.
- No golden per-brand fixture suite (candidate follow-up spec).
- No UI "binding explainer" (candidate follow-up spec).
- No removal of the four legacy coercers (follow-up cleanup once normalization has
  soaked in production).
- No plugin-side changes, no worker isolation, no new events, no API changes, no DB
  migration.

## Acceptance criteria

- [x] `normalizeValue` implements the F1 table exactly, with unit tests per row; an
      unknown declared type (community plugin) passes through unflagged.
- [x] A z2m-style payload `{"state":"ON"}` on a boolean-declared key stores and
      propagates `true`; `{"power":"42.5"}` on a number-declared key propagates `42.5`.
- [x] An un-coercible value stores raw and warns exactly once per (deviceId, key).
- [x] A declared type contradicting `CATEGORY_EXPECTED_TYPE` warns at discovery
      (ON/OFF enums accepted for boolean-expected categories — Tasmota pattern).
- [x] UI and backend import the same module (`ui/src/lib/binding-candidates.ts` is a
      thin re-export); existing backend candidate tests pass against the shared module.
- [x] A dimmable (`state`+`brightness`) Zigbee light yields a candidate for a
      `light_dimmable` equipment through the runtime UI path.
- [x] A boolean-relay device (order `state`, category `light_toggle`) yields a
      `command` candidate for a `gate` equipment; its config-only writable exposes do
      not; the candidate binds no relay-state data.
- [x] `executeOrder` with a null value on a boolean `command` binding dispatches the
      wire "ON" (gate momentary button actuates a Zigbee relay).
- [x] A contact-only sensor still yields a gate candidate (contact data, no order);
      a device with neither trigger nor feedback yields none.
- [x] Somfy RTS (`gate_trigger`) and LoRa (`R1..R4`, reed `RS`) gate bindings behave
      as before (reed feedback now attached per-candidate).
- [x] `npm run validate` green.
