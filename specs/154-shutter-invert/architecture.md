# Spec 154 — Architecture

## Design principle

All command paths funnel through `EquipmentManager.executeOrder`
(`src/equipments/equipment-manager.ts:806`) — per-equipment UI controls (via the
REST `POST /equipments/:id/order`), zone bulk commands (`dispatchZoneCommand`),
recipes, and modes all call it. So the inversion lives in **one backend choke
point** (the write path) and the UI control components (`ShutterControl`,
`EquipmentWidget`, `WidgetDetailSheet`) stay untouched.

Scope is **command-only** (spec 154 FR2/FR3): the read path (reported position +
zone aggregation) is intentionally left raw. This targets move-only motors (the
store-banne / RTS awning); the position-reporting trade-off is documented in the
spec.

## Data model

Mirror the `require_confirmation` precedent (spec 146, migration 018):

- **Migration** `migrations/024_equipment_invert_direction.sql`:
  `ALTER TABLE equipments ADD COLUMN invert_direction INTEGER NOT NULL DEFAULT 0;`
- **Type** (`src/shared/types.ts` + `ui/src/types.ts`): `Equipment.invertDirection?: boolean`.
- **Manager** (`src/equipments/equipment-manager.ts`):
  - `EquipmentRow` gains `invert_direction: number`.
  - `rowToEquipment` maps `invertDirection: row.invert_direction === 1`.
  - `create`/`update` accept and persist it (upsert SQL + the update merge, next
    to `require_confirmation`).
- **API** (`src/api/routes/equipments.ts`): add `invertDirection: { type: "boolean" }`
  to the body schema and thread it into create/update, like `requireConfirmation`.

## Write path (order inversion)

In `executeOrder`, after the order bindings are fetched (so we know the order
`category`) and **before** `resolveOrderValue`, invert the semantic value when
`equipment.invertDirection === true`:

```
const category = bindings[0]?.category;
let semanticValue = value;
if (equipment.invertDirection) {
  if (category === "shutter_move" || category === "pool_cover_move") {
    if (isOpen(value)) semanticValue = "CLOSE";
    else if (isClose(value)) semanticValue = "OPEN";
    // STOP unchanged
  } else if (category === "set_shutter_position" || category === "pool_cover_position") {
    if (typeof value === "number") semanticValue = 100 - value;
  }
}
const resolvedValue = this.resolveOrderValue(bindings[0], semanticValue);
```

- Inversion happens on the **semantic** value (`OPEN`/`CLOSE`/number) before it is
  mapped to the binding's wire representation, so it composes with enum wire
  values and the boolean rules already handled by `resolveOrderValue`.
- `isOpen`/`isClose` compare case-insensitively (`"OPEN"`, `"open"`, and the
  enum-declared synonyms already normalized upstream).
- Only the shutter-family order categories are touched; every other order passes
  through unchanged, so a non-shutter type with a stray flag is a no-op.

Because `dispatchZoneCommand` and recipes/modes all reach the device through
`executeOrder`, they inherit the inversion with no per-caller change. The
`allShutters*` / `allAwnings*` presets stay as-is (they still send the semantic
`OPEN`/`CLOSE`; the per-equipment flag flips it at dispatch).

**Delivery-retry exception (spec 141).** The order-confirmation tracker captures
the RESOLVED value from `equipment.order.executed` (already inverted) and replays
it through `executeOrder` with `source = { kind: "external", channel:
RETRY_CHANNEL }`. Inverting again would double-invert, so `executeOrder` skips the
inversion for that source and re-sends the captured value verbatim. Confirmation
comparison already operates on the resolved value, so it stays correct.

## Read path

Intentionally unchanged (command-only). The reported `shutter_position` and the
zone aggregator's deployed/open count keep the raw device value. This keeps the
change small and device-data raw; the position-reporting trade-off is accepted in
the spec (target is move-only motors).

## UI

- Equipment edit form (`ui/src/components/equipments/...` edit): add a toggle bound
  to `invertDirection`, rendered only when the type is shutter-family
  (`shutter | awning | pool_cover`). Reuse the existing toggle styling used for
  `requireConfirmation`.
- No change to `ShutterControl` / `EquipmentWidget` / `WidgetDetailSheet`: they
  already send semantic `OPEN`/`CLOSE`; the flip happens in `executeOrder`.

## Affected files

- `migrations/024_equipment_invert_direction.sql` (new)
- `src/shared/types.ts`, `ui/src/types.ts` — `invertDirection?: boolean`
- `src/equipments/equipment-manager.ts` — row/type, create/update, `executeOrder`
  write inversion
- `src/api/routes/equipments.ts` — schema + threading
- Equipment edit UI — toggle
- Tests: `equipment-manager.test.ts` (write inversion move + position), API
  round-trip, UI toggle component test

## Sequence (write)

```
UI Open button / zone allAwningsExtend / recipe action
  → EquipmentManager.executeOrder(id, alias, "OPEN"|number)
    → fetch order bindings (category known)
    → if invertDirection: OPEN↔CLOSE  |  pos → 100−pos   (STOP unchanged)
    → resolveOrderValue → dispatchToBinding → integration → device
```
