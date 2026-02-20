# Architecture: V0.7 Zone Aggregation Engine

## Data Model Changes

### New type: `ZoneAggregatedData`

Added to `src/shared/types.ts` and `ui/src/types.ts`:

```typescript
interface ZoneAggregatedData {
  temperature: number | null;
  humidity: number | null;
  motion: boolean;
  openDoors: number;
  openWindows: number;
  waterLeak: boolean;
  smoke: boolean;
  lightsOn: number;
  lightsTotal: number;
}
```

### New event: `zone.data.changed`

```typescript
| {
    type: "zone.data.changed";
    zoneId: string;
    aggregatedData: ZoneAggregatedData;
  }
```

### No database changes

Aggregated data is cached in memory only (as per spec §Zone Aggregation: "Cache aggregated values in memory (not in SQLite) for performance").

## Aggregation Rules

| Key | Type | Strategy | Source DataCategory | Logic |
|-----|------|----------|-------------------|-------|
| `temperature` | number \| null | AVG | `temperature` | Average of all non-null values |
| `humidity` | number \| null | AVG | `humidity` | Average of all non-null values |
| `motion` | boolean | OR | `motion` | true if ANY binding is true/ON |
| `openDoors` | number | COUNT | `contact_door` | Count where value = false/OFF (open) |
| `openWindows` | number | COUNT | `contact_window` | Count where value = false/OFF (open) |
| `waterLeak` | boolean | OR | `water_leak` | true if ANY binding is true/ON |
| `smoke` | boolean | OR | `smoke` | true if ANY binding is true/ON |
| `lightsOn` | number | COUNT | `light_state` | Count where value = true/ON |
| `lightsTotal` | number | COUNT | `light_state` | Count of all light_state bindings |

### Recursive strategy

- AVG: weighted average (zone AVG * count + child AVGs * child counts) / total count
- OR: true if zone OR any child is true
- COUNT: zone count + sum of child counts

## Event Flow

```
equipment.data.changed
  → ZoneAggregator.handleEquipmentDataChanged()
    → Look up equipment's zoneId
    → Recompute zone aggregation (direct equipments)
    → Walk up parent chain, recompute each parent (includes children)
    → For each zone where aggregation changed:
      → Emit zone.data.changed { zoneId, aggregatedData }
        → WebSocket broadcasts to UI clients
        → UI store updates in-memory cache
        → ZoneAggregationHeader re-renders

equipment.created / equipment.updated / equipment.removed
  → ZoneAggregator.handleEquipmentChanged()
    → Recompute affected zone chain

system.started
  → ZoneAggregator.computeAll()
    → Compute aggregation for ALL zones bottom-up
```

## API Changes

### New endpoint

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/zones/aggregation` | Returns aggregated data for all zones |

**Response format:**
```json
{
  "zone-id-1": { "temperature": 21.5, "humidity": 45, "motion": false, ... },
  "zone-id-2": { "temperature": null, "humidity": null, "motion": true, ... }
}
```

## UI Changes

### New component: `ZoneAggregationHeader`

Location: `ui/src/components/maison/ZoneAggregationHeader.tsx`

Displays a horizontal bar of pills/badges above the equipment list:

```
21.5°C  💧 45%  🟢 Mouvement  💡 2/4  🚪 1 ouverte
```

Rules:
- Only show pills for values that have data (not null, not zero count for contacts)
- Temperature: `{value}°C` with Thermometer icon
- Humidity: `{value}%` with Droplets icon
- Motion: green dot + "Mouvement" if true, gray "Calme" if false (only if zone has motion sensors)
- Lights: `{on}/{total}` with Lightbulb icon (only if zone has lights)
- Doors: `{count} ouverte(s)` with DoorOpen icon (only if count > 0)
- Windows: `{count} ouverte(s)` with window icon (only if count > 0)
- Water leak: red alert badge (only if true)
- Smoke: red alert badge (only if true)

### New store: `useZoneAggregation`

Location: `ui/src/store/useZoneAggregation.ts`

```typescript
interface ZoneAggregationState {
  data: Record<string, ZoneAggregatedData>;
  fetchAggregation: () => Promise<void>;
  handleZoneDataChanged: (zoneId: string, aggregatedData: ZoneAggregatedData) => void;
}
```

### Modified files

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `ZoneAggregatedData` interface, `zone.data.changed` event |
| `ui/src/types.ts` | Mirror `ZoneAggregatedData`, `zone.data.changed` event |
| `src/zones/zone-aggregator.ts` | **New** — Aggregation engine |
| `src/index.ts` | Wire up ZoneAggregator |
| `src/api/routes/zones.ts` | Add GET `/zones/aggregation` endpoint |
| `ui/src/store/useZoneAggregation.ts` | **New** — Zustand store |
| `ui/src/store/useWebSocket.ts` | Handle `zone.data.changed` event |
| `ui/src/api.ts` | Add `getZoneAggregation()` API function |
| `ui/src/components/maison/ZoneAggregationHeader.tsx` | **New** — Header component |
| `ui/src/pages/MaisonPage.tsx` | Add `ZoneAggregationHeader` above equipments |
