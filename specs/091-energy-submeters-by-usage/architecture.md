# Architecture — Spec 091

## Data model

### DeviceSelector eligibility — UI only

`ui/src/components/equipments/DeviceSelector.tsx`:

```ts
const EQUIPMENT_TYPE_CATEGORIES: Partial<Record<EquipmentType, DataCategory[]>> = {
  // ...
  energy_meter: ["energy", "power"], // was ["energy"]
  // main_energy_meter unchanged — power-only main meter is out of scope.
};
```

This is purely a filter to surface the device in the picker. The
`bindingUtils` mapping for `energy_meter`'s expected aliases also gets
`power` added so the alias picker shows it.

### New SQLite table — `submeter_integrator_state`

```sql
CREATE TABLE IF NOT EXISTS submeter_integrator_state (
  equipment_id    TEXT PRIMARY KEY REFERENCES equipments(id) ON DELETE CASCADE,
  pending_wh      REAL NOT NULL DEFAULT 0,    -- Wh accumulated since the last write
  last_sample_at  TEXT,                       -- ISO 8601 of the last power sample
  last_sample_w   REAL,                       -- last power value (signed)
  last_write_at   TEXT,                       -- ISO 8601 of the last InfluxDB write
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Submeter writes are **per-minute deltas** (Wh consumed in that minute), aligning with how the main meter writes. The energy downsampling tasks
(`sowel-energy-sum-hourly` / `sowel-energy-sum-daily`) sum across category=energy points — submeters must therefore emit deltas, not cumulatives.

Migration `009_submeter_integrator_state.sql`. Per-submeter rather than
per-binding to keep the equipment as the unit of truth — multiple
power-bindings on one submeter equipment (rare) sum into one stream.

### New module — `src/energy/power-submeter-integrator.ts`

```
SubmeterIntegrator
  on equipment.data.changed (alias = "power", equipment.type = "energy_meter")
    if device-level binding category was "power" (i.e. device has no
    real "energy"):
      now = event.timestamp
      prev = state.last_sample_at, prevW = state.last_sample_w
      if prev exists and (now - prev) <= STALE_THRESHOLD_S (600s):
        ΔWh = trapezoidal((prevW + currentW) / 2) * (now - prev) / 3600
        if ΔWh < 0: ΔWh = 0    (clamped + logged once)
        state.cumulative_wh += ΔWh
      state.last_sample_at = now
      state.last_sample_w = currentW
      persist(state)

  every minute (writer ticker):
    for each submeter with last_write_value_wh != cumulative_wh:
      historyWriter.writeAligned(
        equipmentId, alias="energy", value=cumulative_wh,
        category="energy", timestamp=floor-to-minute(now),
      )
      state.last_write_at = now
      state.last_write_value_wh = cumulative_wh
      persist(state)
```

Why two phases (integrate on event, write on tick): we want sample-accurate
integration (using the actual report timestamps) but a steady, bounded
write rate to InfluxDB. The minute ticker also acts as a heartbeat — if no
power events arrive (device dropped), we simply re-write the same value
(or skip — see dedup).

Stale handling: if the gap since the last sample exceeds
`STALE_THRESHOLD_S = 600s`, the integrator does **not** extrapolate — it
just refreshes `last_sample_at/last_sample_w` to the new sample but does
not increment `cumulative_wh`. This avoids runaway numbers during device
offline windows.

### History attribution

Submeter integrator calls `HistoryWriter` directly with explicit
metadata so the point lands in the energy buckets like a main meter
write:

```ts
historyWriter.writeAligned({
  equipmentId,
  alias: "energy",
  value: cumulativeWh,
  category: "energy",
  timestamp: minuteAlignedEpochMs,
});
```

`HistoryWriter` already knows that `category=energy` routes through the
energy buckets and runs the HP/HC split for `alias=energy`. We deliberately
**skip** the HP/HC split for submeters: we add a check in `HistoryWriter`
that suppresses the HP/HC sub-write when the equipment type is
`energy_meter`. (Submeters report consumption only, not tariff-bucketed.)

### Boot path

On engine boot, `SubmeterIntegrator` loads its state from SQLite and
re-arms the minute ticker. Cumulative values resume from the persisted
value — no backfill of the off-period.

If a submeter's `equipmentId` no longer exists (deleted), the row is
dropped via the FK cascade.

## API

New endpoint:

```
GET /api/v1/energy/by-usage?period=day|week|month|year&date=YYYY-MM-DD

Response:
{
  "period": "day",
  "from": "...",
  "to": "...",
  "resolution": "1h",
  "submeters": [
    { "id": "<equipmentId>", "name": "PAC",      "color": "#…", "points": [{ "time":"…", "wh": 1234 }, …] },
    { "id": "<equipmentId>", "name": "Piscine",  "color": "#…", "points": [...] },
  ],
  "other": { "points": [{ "time": "...", "wh": 567 }, ...] },
  "totals": {
    "byEquipment": { "<id>": 12345, "<id>": 6789 },
    "other": 4500,
    "total": 23634
  }
}
```

Implementation reuses the existing `computeRange()` and the same
Flux query template as `queryEnergyPoints`, repeated per submeter:

```flux
from(bucket: "${bucket}")
  |> range(start: ${from}, stop: ${to})
  |> filter(fn: (r) => r._measurement == "device_data")
  |> filter(fn: (r) => r.equipmentId == "${submeterId}")
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "energy")
  |> aggregateWindow(every: ${resolution}, fn: sum, timeSrc: "_start")
```

`other.points[i].wh = max(0, total.points[i].wh - Σ submeters[i].wh)`.

Color per submeter: deterministic palette indexed by submeter id (sorted),
using the same accent palette as the rest of the design system.

## UI

`ui/src/components/energy/EnergyPage.tsx`:

- New piece of state `viewMode: "total" | "by-usage"`.
- Toggle button group above the chart, hidden when no submeter exists.
- When `by-usage`:
  - Fetch `/energy/by-usage` (in addition to or in place of `/energy/history`
    — TBD by impl: simplest is to fetch both, the totals widgets keep
    using `/energy/history`).
  - Render `EnergyBarChart` with one `dataKey` per submeter +
    `dataKey="other"`. Reuse the existing stacked bar shape; just change
    the keys/colors.

`ui/src/components/energy/EnergyBarChart.tsx`:

- Accept a `series: { id, name, color, points }[]` prop alternative to
  the current hp/hc/prod/autoconso/injection layout. Tooltip shows
  per-equipment Wh and the "Other" residual.

i18n keys (FR + EN):

- `energy.viewMode.total` → "Total" / "Total"
- `energy.viewMode.byUsage` → "Par usage" / "By usage"
- `energy.byUsage.other` → "Autre" / "Other"

## Event flow

```
zigbee2mqtt plugin → DeviceManager.updateDeviceData(power=W)
  → equipment.data.changed event (alias="power")
    → SubmeterIntegrator.handlePowerEvent
      (updates cumulative_wh in memory + SQLite)

minute ticker
  → SubmeterIntegrator.flushAll
    → HistoryWriter.writeAligned(category="energy", value=cumulative_wh)
      → InfluxDB sowel bucket
        → existing downsampling tasks → sowel-energy-hourly + daily
```

## Files

| Action | File                                                                                   |
| ------ | -------------------------------------------------------------------------------------- |
| add    | `migrations/009_submeter_integrator_state.sql`                                         |
| add    | `src/energy/power-submeter-integrator.ts`                                              |
| add    | `src/energy/power-submeter-integrator.test.ts`                                         |
| edit   | `src/index.ts` — wire up SubmeterIntegrator at boot                                    |
| edit   | `src/history/history-writer.ts` — skip HP/HC split for `energy_meter` type             |
| edit   | `src/api/routes/energy.ts` — add `/energy/by-usage` endpoint                           |
| add    | `src/api/routes/energy-by-usage.test.ts`                                               |
| edit   | `ui/src/components/equipments/DeviceSelector.tsx` — `power` allowed for `energy_meter` |
| edit   | `ui/src/components/equipments/bindingUtils.ts` — alias mapping                         |
| edit   | `ui/src/components/energy/EnergyPage.tsx` — toggle + by-usage data fetch               |
| edit   | `ui/src/components/energy/EnergyBarChart.tsx` — multi-series mode                      |
| edit   | `ui/src/api.ts` — `getEnergyByUsage()` client                                          |
| edit   | `ui/src/types.ts` — response types                                                     |
| edit   | `ui/src/i18n/locales/{fr,en}.json` — labels                                            |
