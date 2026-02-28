# Architecture: Sunrise/Sunset

## Dependency

- npm package: `suncalc` (MIT, zero deps, well-maintained)

## Data Model Changes

### ZoneAggregatedData (src/shared/types.ts + ui/src/types.ts)

Add three new optional fields:

```typescript
export interface ZoneAggregatedData {
  // ... existing fields ...
  sunrise: string | null; // "HH:mm" format, e.g. "07:23"
  sunset: string | null; // "HH:mm" format, e.g. "20:45"
  isDaylight: boolean | null; // true between sunrise+offset and sunset-offset
}
```

These fields are **only populated on the root zone** — child zones inherit them from the root via the existing aggregation chain.

### Settings (SQLite settings table)

New keys (stored as strings in existing `settings` table):

| Key                  | Example value |
| -------------------- | ------------- |
| `home.latitude`      | `"48.8566"`   |
| `home.longitude`     | `"2.3522"`    |
| `home.sunriseOffset` | `"30"`        |
| `home.sunsetOffset`  | `"45"`        |

No migration needed — settings table is key-value.

## New Module: SunlightManager

**File:** `src/zones/sunlight-manager.ts`

Responsibilities:

- Read location settings from SettingsManager
- Compute sunrise/sunset using `suncalc`
- Maintain current `isDaylight` state
- Check for transitions every 60 seconds
- Emit `zone.data.changed` on the root zone when `isDaylight` transitions

### Lifecycle

```
Engine startup
  → SunlightManager.start()
    → Read settings (lat, lon, offsets)
    → Compute today's sunrise/sunset
    → Compute current isDaylight
    → Start 60-second interval timer

Every 60 seconds:
  → Recompute isDaylight
  → If changed → emit zone.data.changed for root zone

Midnight (detected by date change in interval):
  → Recompute sunrise/sunset for new day

Settings changed:
  → eventBus "settings.changed" → recompute everything
```

### Public API

```typescript
class SunlightManager {
  start(): void;
  stop(): void;
  getSunlightData(): { sunrise: string | null; sunset: string | null; isDaylight: boolean | null };
}
```

## Integration with Zone Aggregator

**File:** `src/zones/zone-aggregator.ts`

The aggregator already computes `ZoneAggregatedData` for each zone. For the root zone, it will call `sunlightManager.getSunlightData()` and merge the result.

**Change:** In `accumulatorToPublic()` (or equivalent), when building root zone data:

```typescript
if (zoneId === ROOT_ZONE_ID) {
  const sunlight = this.sunlightManager.getSunlightData();
  data.sunrise = sunlight.sunrise;
  data.sunset = sunlight.sunset;
  data.isDaylight = sunlight.isDaylight;
}
```

## Event Flow

```
SunlightManager (isDaylight transitions)
  → eventBus: "zone.data.changed" { zoneId: ROOT_ZONE_ID, data: { ...existing, sunrise, sunset, isDaylight } }
    → WebSocket broadcast to UI clients
    → Recipe engine evaluates conditions (isDaylight changed)
```

## API Changes

No new endpoints. Data flows through existing:

- `GET /api/v1/zones/aggregation` — root zone entry now includes sunrise/sunset/isDaylight
- WebSocket `zone.data.changed` events include the new fields

## UI Changes

### ZoneAggregationPills (ui/src/components/home/ZoneAggregationPills.tsx)

Add a sunrise/sunset pill (only shown for root zone or when data exists):

```
☀ 07:23 — 20:45  (Jour)
```

or

```
☾ 07:23 — 20:45  (Nuit)
```

- Icon: `Sunrise` / `Moon` from Lucide
- Color: warm yellow for day, blue-grey for night
- Format: sunrise — sunset with day/night label

### Settings Page

Add a "Home" section in Administration > Settings with:

- Latitude (number input)
- Longitude (number input)
- Sunrise offset in minutes (number input, default 30)
- Sunset offset in minutes (number input, default 45)

## File Changes

| File                                              | Change                                                  |
| ------------------------------------------------- | ------------------------------------------------------- |
| `package.json`                                    | Add `suncalc` dependency                                |
| `src/shared/types.ts`                             | Add sunrise/sunset/isDaylight to ZoneAggregatedData     |
| `ui/src/types.ts`                                 | Mirror ZoneAggregatedData changes                       |
| `src/zones/sunlight-manager.ts`                   | **NEW** — sunrise/sunset computation + isDaylight timer |
| `src/zones/zone-aggregator.ts`                    | Inject sunlight data into root zone aggregation         |
| `src/index.ts`                                    | Create and start SunlightManager                        |
| `ui/src/components/home/ZoneAggregationPills.tsx` | Add sunrise/sunset pill                                 |
| `ui/src/pages/SettingsPage.tsx` (or equivalent)   | Add home location settings                              |
| `ui/src/i18n/locales/fr.json`                     | Labels for new settings + aggregation pill              |
| `ui/src/i18n/locales/en.json`                     | Labels for new settings + aggregation pill              |
