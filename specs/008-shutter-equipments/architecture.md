# Architecture: Shutter Equipment Controls & Aggregation

## Data Model Changes

### types.ts — ZoneAggregatedData

Add three new fields:

```typescript
export interface ZoneAggregatedData {
  // ... existing fields ...
  shuttersOpen: number;              // COUNT of shutters with position > 0
  shuttersTotal: number;             // COUNT of all shutter_position bindings
  averageShutterPosition: number | null; // AVG of position values (null if none)
}
```

### No database changes

Zone aggregation is computed in-memory, not persisted.

## Event Bus Events

- No new events. Existing `zone.data.changed` carries updated `ZoneAggregatedData` which now includes shutter fields.

## MQTT Topics

- No new topics. Shutter orders use existing `executeOrder()` → `mqttConnector.publish()` flow.
- Open: `zigbee2mqtt/<device>/set` with `{"state": "OPEN"}`
- Close: `zigbee2mqtt/<device>/set` with `{"state": "CLOSE"}`
- Stop: `zigbee2mqtt/<device>/set` with `{"state": "STOP"}`

## API Changes

- No new endpoints. `GET /api/v1/zones/aggregation` already returns `ZoneAggregatedData`.

## Backend Changes

### zone-aggregator.ts

Add shutter accumulation:

```typescript
// Accumulator additions:
shutterPositionSum: number;
shutterPositionCount: number;
shuttersOpen: number;      // position > 0
shuttersTotal: number;     // all shutter_position bindings with numeric value

// In accumulateBindings, case "shutter_position":
//   shuttersTotal += 1
//   if position > 0: shuttersOpen += 1
//   shutterPositionSum += value, shutterPositionCount += 1

// In accumulatorToPublic:
//   averageShutterPosition = count > 0 ? round(sum/count) : null
```

### zone-aggregator.test.ts

Add tests:
- Shutter aggregation with mixed positions
- Empty zone has null averageShutterPosition and 0 counts
- Equality check includes new fields

## UI Changes

### CompactEquipmentCard.tsx

Add shutter control section (similar pattern to light controls):

```
┌─────────────────────────────────────────────────────┐
│ ↕  Volets Salon           65%    [▲]  [■]  [▼]     │
└─────────────────────────────────────────────────────┘
```

- Detect `equipment.type === "shutter"`
- Find `shutter_position` data binding for position display
- Find `state` order binding for Open/Close/Stop buttons
- Buttons: ChevronUp (Open), Square (Stop), ChevronDown (Close)
- Disabled state during execution

### ZoneAggregationHeader.tsx

Add shutter pill after lights pill:

```
[↕ 2/4 · 65%]
```

- Show when `data.shuttersTotal > 0`
- Icon: `ArrowUpDown`
- Text: `{shuttersOpen}/{shuttersTotal}`
- Suffix: ` · {averageShutterPosition}%` when available
- Color: `text-primary` when some open, `text-text-tertiary` when all closed

### types.ts (frontend)

Mirror backend `ZoneAggregatedData` changes.

## File Changes

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add shuttersOpen, shuttersTotal, averageShutterPosition to ZoneAggregatedData |
| `src/zones/zone-aggregator.ts` | Add shutter accumulation logic |
| `src/zones/zone-aggregator.test.ts` | Add shutter aggregation tests |
| `ui/src/types.ts` | Mirror ZoneAggregatedData changes |
| `ui/src/components/home/CompactEquipmentCard.tsx` | Add shutter controls (buttons + position %) |
| `ui/src/components/home/ZoneAggregationHeader.tsx` | Add shutter pill |
