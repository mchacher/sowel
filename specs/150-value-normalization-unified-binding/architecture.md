# Spec 150 — Architecture

## Overview

Three independent workstreams sharing one theme: make the device→equipment data
contract explicit and enforce it in exactly one place each.

```
Integration plugin (any protocol)
  → DeviceManager.updateDeviceData
      └── [NEW] normalizeValue(value, declaredType, enumValues)   ← single authority
  → device.data.updated (normalized value)
  → EquipmentManager / ZoneAggregator / HistoryWriter / UI (unchanged, now stable input)

UI DeviceSelector / bindingUtils
  └── [CHANGED] import computeBindingCandidates + CANDIDATE_BASED_TYPES
      from the single shared module (backend-owned)
```

## New files

| File                                     | Content                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/value-normalization.ts`      | `normalizeValue(value: unknown, type: DataType, enumValues?: string[] \| null): { value: unknown; flagged: boolean }` — pure, no deps. Implements the F1 table.                                                                                                                                                                    |
| `src/shared/value-normalization.test.ts` | Unit tests, one describe per declared type.                                                                                                                                                                                                                                                                                        |
| `src/shared/binding-candidates.ts`       | Moved from `src/equipments/binding-candidates.ts` (complete implementation). Input types (`CandidateDeviceData`, `CandidateDeviceOrder`) declared locally and structurally minimal (key/type/category/enumValues) so the UI can pass its own device objects without importing backend types. Also exports `CANDIDATE_BASED_TYPES`. |

## Changed files — backend

| File                                        | Change                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/constants.ts`                   | Add `CATEGORY_EXPECTED_TYPE: Partial<Record<DataCategory, DataType>>`.                                                                                                                                                                                                                                               |
| `src/devices/device-manager.ts`             | `updateDeviceData`: look up declared `device_data` rows for incoming keys, run `normalizeValue` before persist + event emission; warn-once dedupe `Set<string>` keyed `deviceId:key` (F3). Discovery upsert (`upsertFromDiscovery`): warn when declared type contradicts `CATEGORY_EXPECTED_TYPE` (F4), same dedupe. |
| `src/equipments/binding-candidates.ts`      | Deleted; `equipment-manager` imports `inferBindingCategory` from `../shared/binding-candidates.js` (only internal runtime importer).                                                                                                                                                                                 |
| `src/equipments/binding-candidates.test.ts` | Moves to `src/shared/binding-candidates.test.ts`; gains the F7 gate cases + dimmable/color boolean-relay cases + a guard that every `CANDIDATE_BASED_TYPES` entry has a dedicated case (never the default fallback).                                                                                                 |
| `src/equipments/equipment-manager.ts`       | `executeOrder`: boolean-binding empty-value resolution (see Gate section below). `inferBindingCategory` import swap.                                                                                                                                                                                                 |
| `src/equipments/metering.ts`                | `METERING_CATEGORIES` moved to `shared/constants.ts` (the shared module cannot import backend layers); re-exported here for existing importers.                                                                                                                                                                      |

### `updateDeviceData` insertion point

Normalization happens inside the existing per-key loop, before the
`JSON.stringify(value)` persist and before the `device.data.updated` payload is
assembled — so DB, event bus, WebSocket and history all see the same normalized
value. Auto-created keys (no declared row yet) skip normalization; their row is
created with `typeof`-inferred type exactly as today, and subsequent updates
normalize against that row.

Failure semantics: `normalizeValue` never throws; a flagged result stores the raw
value (today's behavior) + warn-once. Handlers stay non-throwing per CLAUDE.md.

## Changed files — UI

| File                                              | Change                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/vite.config.ts`                               | `server.fs.allow: [".", "../src/shared"]` — the dev server's default allow-list stops at `ui/`; scoped to the shared dir (not the repo root) so `data/` and `.env` are never served over `/@fs/`.                                                                                                                                                                                                                                              |
| `ui/src/lib/binding-candidates.ts`                | Becomes a thin re-export of `../../../src/shared/binding-candidates` (relative import — no alias needed; see decision in plan.md). All existing UI import sites (`bindingUtils`, `DeviceSelector`, `binding-utils`) stay untouched.                                                                                                                                                                                                            |
| `ui/src/lib/binding-candidates.test.ts`           | Kept — it now exercises the shared module through the re-export, guarding the cross-root import path in UI context.                                                                                                                                                                                                                                                                                                                            |
| `ui/src/components/equipments/bindingUtils.ts`    | Import `CANDIDATE_BASED_TYPES` from the re-export; delete the local copy. `TYPE_DATA_CATEGORY_ALIASES` renamed `TYPE_CATEGORY_ALIASES` (data and order categories are disjoint namespaces) and gains `gate: { light_toggle: "command", toggle_power: "command" }` so a Zigbee relay order bound to a gate resolves to the `command` alias GateControl listens to. Gate `RELEVANT_*` rows kept for the manual AddBindingModal path (commented). |
| `ui/src/components/equipments/DeviceSelector.tsx` | Same import swap; delete local `CANDIDATE_BASED_TYPES`; remove the gate special-case compatibility filter and the dead `EQUIPMENT_TYPE_CATEGORIES.gate` entry — gate compatibility now flows from `candidates.length > 0` like every other candidate-based type.                                                                                                                                                                               |

**Decision (implementation)**: relative re-export chosen over a path alias — zero
config surface on the module graph, all UI import sites unchanged, verified against
`tsc -b`, `vite build` (Rollup) and the dev server (`/@fs/` 200).

## Gate candidate shape (F7, as implemented)

```ts
case "gate": {
  const isGateTriggerOrder = (o) =>
    isOnOffOrder(o) ||                        // boolean/enum on-off relay (Zigbee, Tasmota)
    /^R[1-4]$/.test(o.key) ||                 // LoRa relay channels
    o.key === "command" || o.key === "gate_trigger" ||
    o.category === "gate_trigger";            // Somfy RTS & friends
  // feedback = data rows with key RS* (LoRa reed) or category contact_door/contact_window
  // 1 candidate per trigger order: orderKeys=[o.key], dataKeys=[...feedback]
  //   (relay's own state data deliberately NOT bound — virtual-state alias
  //    collision + zone lights-on pollution)
  // + "contact" candidate when feedback exists and no trigger order
  // + NO blanket fallback: no trigger, no feedback → zero candidates
}
```

Alias chain per protocol (verified in review): Zigbee `light_toggle`/`toggle_power`
→ `command` via `TYPE_CATEGORY_ALIASES` (bindingUtils, also honored by
AddBindingModal); LoRa `R1..R4` → `command` via `STANDARD_ALIASES`; Somfy →
`command` via `ORDER_CATEGORY_ALIASES.gate_trigger`.

Dispatch: `executeOrder` gains the boolean twin of the "empty → first enum value"
rule — on a binding of `type === "boolean"` with no `enum_values`, a null/empty
value resolves to `true` before `resolveWireValue` maps onto
`value_on`/`value_off` (spec #360). Without this, GateControl's momentary button
(which sends `null`) reached the wire as `{"state":null}` and Z2M dropped it
silently. Non-empty values pass through untouched: wire mapping already handles
booleans and on/off strings when wire values are declared, and pre-2.3.0 z2m
plugins rely on raw `"ON"` strings reaching the wire unchanged. Momentary/pulse behavior remains a
device-side configuration (e.g. MINI-ZBD inching / `on_time`, documented in user
docs), not a core concern.

## Event flow, API, DB

- **No new events**, no event payload changes (values simply arrive normalized).
- **No API changes.**
- **No migration.** `device_data.value` cells normalize lazily on the next update of
  each key. Consumers already tolerate both old and new forms during the transition.

## Interactions reviewed (no change needed)

| Consumer                                       | Effect of normalization                                                                                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zone-aggregator` (`isBooleanActive`…)         | Already accepts `true`/`"ON"`; previously-missed vocabularies (`"true"`, `1`) now arrive as `true` and count correctly.                                                                           |
| `deriveGateState` (boolean-only contact check) | String contacts now arrive boolean → derivation works for plugins that emitted `"true"`/`"1"`.                                                                                                    |
| `history-writer`                               | Field types stable (`value_string` + `value_number` per declared type). Numeric strings previously skipped `value_number`; now recorded. Its inline boolean check becomes redundant but harmless. |
| `order-confirmation` (spec 141)                | Compares ordered vs observed values — benefits from stable types; vocabulary comparison logic untouched.                                                                                          |
| UI cards testing `value === true`              | Were broken for string-emitting devices; now receive `true`. Tolerant checks elsewhere stay valid.                                                                                                |
| Recipes                                        | Receive normalized values; edge-guard conventions unchanged.                                                                                                                                      |
