# Architecture — Spec 120 — Display equipment type

## Design decisions

### D1 — New `DataCategory` values rather than overloading existing ones

The 5 state fields a Sowel display reports do not match any current
category cleanly:

| New category         | Why it cannot reuse an existing one                                                |
| -------------------- | ---------------------------------------------------------------------------------- |
| `firmware_version`   | No existing semantic match; broadly useful (Zigbee / MQTT / Tasmota all expose it) |
| `uptime`             | Same — generic device health, no existing category                                 |
| `rssi`               | Same — applicable to any radio-attached device; we just have not had a slot for it |
| `language`           | Niche but cleanly typed (ISO 639-1); no analogous string-enum category exists      |
| `display_brightness` | `light_brightness` already exists with identical wire shape — but see D2 below     |

These 5 are introduced as part of this spec because we need them today,
but the first 3 (`firmware_version`, `uptime`, `rssi`) are intentionally
generic so future device plugins can adopt them without a category churn.

### D2 — `display_brightness` separated from `light_brightness`

Both carry an identical wire shape (`number`, 0..100). A naive read of
"reuse the existing category" is tempting and was the first instinct.
The actual cost of reuse: a recipe filtered by category — "set
`light_brightness` to 0 in zone Salon" — would touch the display too,
which is wrong. Filtering at the equipment-type layer would force every
recipe author to remember the carve-out.

Forking the category at the wire layer (`display_brightness`) keeps the
recipe DSL straightforward at the cost of one extra enum row. Same
trade-off as D1 in spec 115 (`pool_cover_position` vs `shutter_position`,
where pool covers got a dedicated category for safety reasons).

### D3 — `EquipmentStatus` reuses spec 116 derivation, no new state machine

`Device.status` is the authoritative online / offline flag for the
underlying plugin entity. When the MQTT LWT fires, the plugin marks the
device offline; `EquipmentStatus` (spec 116) derives "offline" from
that, no change here. The detail card uses the existing `<OfflineOverlay>`
component shared by every equipment type.

### D4 — Polymorphic data + orders, validated by binding presence

The plugin advertises only the orders a given display has honoured (see
the plugin spec, separate repo). From Sowel's perspective, the
`DeviceOrder` list on the device IS the source of truth — the detail
card iterates `device.orders` and renders the matching control if the
category appears. Nothing is hard-coded per equipment type beyond the
"5 known categories" list for layout ordering.

Concretely: the equipment-detail UI does not say "if equipment.type ===
'display' then render brightness". It says "if any bound device has a
data of category `display_brightness`, render the brightness row". The
type's only job is to gate the layout (which rows in which order).

### D5 — Widget family `displays`, no zone commands in v1

Spec 115 (awning) added `allAwningsExtend / Stop / Retract` zone
commands; we deliberately ship none for displays. Rationale: the most
plausible zone commands ("set brightness to 0 across the zone", "switch
language across the zone") are 1-equipment-per-zone in practice, and we
do not want to commit to a vocabulary before we see the use case. Adding
zone commands later is additive.

### D6 — `rssi` is event-driven, not streaming

`STREAMING_CATEGORIES` (spec 116) marks categories that update fast
enough to warrant a separate "live" pipeline. RSSI on a display updates
roughly once per minute — well within the regular `DeviceData` cadence.
We do NOT add it to `STREAMING_CATEGORIES`.

### D7 — No new `DeviceSource`

The plugin will reuse `custom_mqtt` as its `DeviceSource` value. We
considered `sowel_display` but plugins are supposed to be polymorphic
on the wire format, not the entity type — a future bridge that publishes
displays via a different protocol would carry a different source.

## Data model

### `src/shared/types.ts`

```ts
// Line ~7 — extend DataCategory
export type DataCategory =
  | "motion"
  | ... // existing
  | "pool_temperature_setpoint"
  // Spec 120 — display equipment
  | "firmware_version"
  | "uptime"
  | "rssi"
  | "language"
  | "display_brightness"
  | "generic";

// Line ~51 — extend OrderCategory
export type OrderCategory =
  | "light_toggle"
  | ... // existing
  | "set_pool_temperature_setpoint"
  // Spec 120
  | "set_language"
  | "set_display_brightness";

// Line ~190 — extend EquipmentType
export type EquipmentType =
  | "light_onoff"
  | ... // existing
  | "pool_heat_pump"
  // Spec 120
  | "display";

// Line ~155 — extend ZoneAggregatedData
export interface ZoneAggregatedData {
  ... // existing fields
  // Spec 120 — display family aggregation
  displaysOnline: number;
  displaysTotal: number;
}
```

### `src/shared/constants.ts`

```ts
// WIDGET_FAMILY_TYPES: add a new family
export const WIDGET_FAMILY_TYPES: Record<WidgetFamily, EquipmentType[]> = {
  ... // existing
  displays: ["display"],
};

// WidgetFamily type itself lives in types.ts — add "displays" there too.
```

`STREAMING_CATEGORIES` and `STREAMING_TIMEOUT_MS` are intentionally
**not** modified (see D6).

### Database / migrations

No schema migration required. `Equipment.type` is a string column, no
enum check at the DB layer; the application enforces the enum.
`DataCategory` and `OrderCategory` are similarly string-typed in the
SQLite schema.

## Event flow

Nothing new. The existing reactive pipeline already handles arbitrary
categories and types:

```
MQTT message
  → sowel-plugin-energy-display (parses LWT / state / cmd ack)
    → DeviceManager.updateDeviceData(deviceId, key, value)
      → EventBus: device.data.updated
        → EquipmentManager (re-evaluates bindings + computed Data)
          → EventBus: equipment.data.changed
            → ZoneAggregator (counts displaysOnline)
              → EventBus: zone.data.changed
                → WebSocket → UI
```

`EquipmentStatus` is computed on every read; spec 116 covers the
mechanics.

## API contracts

No new endpoints. Existing routes pick up the new enum values
automatically:

- `POST /api/v1/equipments` — accepts `type: "display"`.
- `POST /api/v1/equipments/:id/bindings` — accepts the 5 new
  `DataCategory` values.
- `POST /api/v1/equipments/:id/orders` — accepts the 2 new
  `OrderCategory` values.
- `GET  /api/v1/equipments/:id` — emits a `DeviceWithDetails` whose
  `data` and `orders` may contain the new entries.

## File changes (rough — refined in plan.md)

### Backend

- `src/shared/types.ts` — extend `DataCategory`, `OrderCategory`,
  `EquipmentType`, `WidgetFamily`, `ZoneAggregatedData`.
- `src/shared/constants.ts` — add `displays` to `WIDGET_FAMILY_TYPES`.
- `src/equipments/equipment-manager.ts` — add `display` to
  `VALID_EQUIPMENT_TYPES`.
- `src/equipments/binding-candidates.ts` — propose the 5 new
  categories for `display`.
- `src/zones/zone-aggregator.ts` — count `displaysOnline / Total`
  in the accumulator + combiner + equality + projection.

### Frontend

- `ui/src/components/dashboard/widgets/DisplaysWidget.tsx` (new) —
  family card.
- `ui/src/components/zones/cards/DisplayCompactCard.tsx` (new) —
  inline row.
- `ui/src/components/equipments/cards/DisplayDetailCard.tsx` (new) —
  full detail view.
- `ui/src/components/equipments/AddEquipmentModal.tsx` — register
  the new equipment type in the "Add equipment" picker.
- `ui/src/i18n/{fr,en}.json` — new keys for the display strings.

### Tests

- `src/equipments/equipment-manager.test.ts` — accept / reject paths.
- `src/equipments/binding-candidates.test.ts` — new categories
  proposed for `display`, not for other types.
- `src/zones/zone-aggregator.test.ts` — `displaysOnline / Total`
  scenarios.
- `src/api/routes/equipments.test.ts` — create / read / order path
  with `type: "display"` (one happy + one reject scenario).

## Risk register

| Risk                                              | Mitigation                                                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Existing recipes accidentally trip `display_*`    | Categories are new — no recipe references them yet. Future recipe authors see them in the picker.    |
| Plugin and Sowel diverge on enum values           | The 5 categories + 2 orders are listed in this spec; plugin spec re-quotes them verbatim.            |
| UI ships before the plugin exists                 | Detail card hides every row whose binding is absent; family card lists 0 displays when none bound.   |
| Brightness slider misfires on a powered-off panel | Plugin contract (separate spec) handles queue/discard; Sowel UI treats the order as fire-and-forget. |
