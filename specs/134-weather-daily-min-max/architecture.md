# Architecture — Spec 134

Follows the `PoolWaterTempTracker` pattern (spec 121): an event-driven
tracker with SQLite persistence exposing `ComputedDataEntry[]` per
equipment. No new API route, no new WebSocket message — `computedData`
already flows through `EquipmentWithDetails` on REST and WS pushes.

## Data model

New table (migration `NNN_weather_temp_extremes.sql`, next sequential
number at implementation time):

```sql
CREATE TABLE IF NOT EXISTS weather_temp_extremes (
  equipment_id TEXT NOT NULL,
  alias        TEXT NOT NULL,
  day          TEXT NOT NULL,   -- local date "YYYY-MM-DD"
  min_value    REAL NOT NULL,
  max_value    REAL NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (equipment_id, alias)
);
```

One row per (equipment, temperature binding alias) — always the current
day's envelope; rollover overwrites in place. No history kept here
(history is InfluxDB's job).

## Tracker

`src/equipments/weather-temp-extremes-tracker.ts`

- Subscribes to `equipment.data.changed`. Guard chain:
  `equipment.type === "weather"` → binding category in
  `{"temperature", "temperature_outdoor"}` → `typeof value === "number"`.
- Local day string from the server timezone (same convention as the
  energy day boundaries; spec 061 owns TZ correctness).
- On sample: if stored `day !== today` → reset envelope to the sample;
  else `min = Math.min`, `max = Math.max`. Persist synchronously
  (better-sqlite3), update in-memory map.
- Midnight is lazy: no timer needed for correctness (the first sample of
  the new day resets), but a light interval (aligned with the pool
  tracker's) re-emits so the UI does not show yesterday's envelope
  before the first morning sample. On rollover with no sample yet, the
  computed entries return null → hidden in UI.
- `getComputedData(equipmentId): ComputedDataEntry[]` — returns, per
  tracked alias with a row for today:
  - `{ alias: "<alias>_min_today", value, unit: "°C", category: <source binding category>, lastUpdated }`
  - `{ alias: "<alias>_max_today", ... }`
- Cleanup on `equipment.removed` (same hook as pool trackers).

Wiring in `src/index.ts`: instantiate next to `PoolWaterTempTracker`,
register its `getComputedData` with the equipment manager's computed-data
providers (same mechanism the pool and energy cumul entries use).

## UI

Matching is by **category** (aliases vary: prod shows outdoor =
`temperature` with category `temperature_outdoor`, indoor =
`temperature_2` with category `temperature`). Helper in
`ui/src/components/equipments/weather-utils.ts`:

```ts
export function findTempExtremes(
  equipment: EquipmentWithDetails,
  category: "temperature" | "temperature_outdoor",
): { min: number; max: number } | null;
```

Resolution: find the source binding of that category, then look up
`computedData` entries `<binding.alias>_min_today` / `_max_today`.
Returns null unless both are numbers.

| File                   | Change                                                                 |
| ---------------------- | ---------------------------------------------------------------------- |
| `EquipmentWidget.tsx`  | `WeatherStationWidget`: outdoor `↓ n° ↑ n°` line under hero temp       |
| `MobileWidgetCard.tsx` | Outdoor min/max in the weather summary + rows in the bottom sheet      |
| `WeatherPanel.tsx`     | Min/max row in outdoor module section and indoor section               |
| `weather-utils.ts`     | `findTempExtremes` helper (unit-tested)                                |
| `fr.json` / `en.json`  | `weather.minToday`, `weather.maxToday` (or arrow glyphs + aria labels) |

Display convention: Lucide `ArrowDown`/`ArrowUp` 12px + `n°` values,
`text-text-tertiary`, JetBrains Mono for values — consistent with the
spec 114 widget styles.

## Event flow

```
plugin poll → device.data.updated → equipment.data.changed (temperature)
  → WeatherTempExtremesTracker (update envelope, persist)
  → equipment computed data refresh → WS push equipment payload
  → UI stores update → widgets re-render
```

No extra WS event: the tracker piggybacks the equipment refresh path the
pool trackers already use.
