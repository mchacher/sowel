# Architecture — Spec 162

## Shape

```
pv-forecaster (already computes POA per hour, per equipment)
        │
        │  daily, after the nightly refit
        ▼
  pv-health.ts ── pure ──┐
    qualifyingHours()    │  10-16 h local, direct fraction > 0.75
    dailyRatio()         │  measured Wh / modelled Wh
    rollingNormal()      │  slow trailing reference
    assess()             │  sustained departure -> alert
                         │
        ┌────────────────┘
        ▼
  pv_health_day (SQLite)      system.alarm.raised / .resolved
        │                              │
        └──────────► API ◄─────────────┘
                      │
                  the card
```

The split is the same one spec 161 used and for the same reason: the rules are a
function from numbers to a verdict, and everything that made this area hard to
review was in the code that needed a clock and a database. `pv-health.ts` needs
neither.

## Where the modelled side comes from

Not from a new computation. `pv-forecaster` already derives the plane-of-array
irradiance for every daylight hour, and already stores it: `pv_forecast_sample`
carries `at`, `hour_local`, `poa`, `temp_c`, `watts` — measured production paired
with the irradiance that produced it, for the rolling 45-day window.

That table is exactly the input this feature needs, and it is already correct:
same POA model, same impossible-reading rejection, same hour convention. The
health check reads it and adds nothing to the collection path.

The consequence is a real bound, and it is stated rather than worked around: the
detector sees **45 days**, because that is what the sample window keeps. Long
enough for a trailing normal, not long enough to compare one June with the next.

## Direct fraction, and where it comes from

`pv_forecast_sample` stores POA, not its beam and diffuse parts, so the direct
fraction is not recoverable from the table alone. Two options were considered:

- **Recompute from the published irradiance series.** The forecaster holds it
  already (`irradiance_120h` for recent hours, `irradiance_history` for 45 days).
  No schema change, but the health check then depends on a plugin series being
  present to judge history it already has.
- **Store the fraction on the sample.** One REAL column, written by the same
  code that already has `hour.direct` and `hour.diffuse` in hand.

The second. A stored fraction makes a past day's qualification a fact rather than
a recomputation that a plugin gap could silently change. Migration 027 adds
`direct_fraction REAL` to `pv_forecast_sample`, nullable: rows written before it
have no fraction and are simply never qualifying, which the day-level minimum
already handles.

## Data model

```sql
-- migration 027
ALTER TABLE pv_forecast_sample ADD COLUMN direct_fraction REAL;

CREATE TABLE pv_health_day (
  equipment_id      TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  day               TEXT NOT NULL,     -- local date, YYYY-MM-DD
  ratio             REAL NOT NULL,     -- measured Wh per Wh/m2 of irradiation
  hours             INTEGER NOT NULL,  -- qualifying hours behind it
  measured_wh       REAL NOT NULL,
  irradiation_wh_m2 REAL NOT NULL,     -- Wh/m2, NOT an energy
  PRIMARY KEY (equipment_id, day)
);

-- One row per array currently below its normal. `normal` is frozen at the raise:
-- recomputed nightly it would absorb the fault and clear the alert on its own
-- after fourteen clear days. No foreign key, following `battery_alerts`: a
-- cascade would drop the row without letting the check emit the resolution.
CREATE TABLE pv_health_alert (
  equipment_id TEXT PRIMARY KEY,
  since        TEXT NOT NULL,
  normal       REAL NOT NULL,
  deficit      REAL NOT NULL,
  raised_at    TEXT NOT NULL
);
```

Both consumers — the alarm path and the card — recompute the day list from
`pv_forecast_sample` rather than reading `pv_health_day` whole. Reading different
windows is how the card came to show a red banner for a fault the engine had just
closed. `pv_health_day` is the persisted record for the chart and is pruned to
the same window in the same transaction that writes it.

Both tables go into `BACKUP_TABLES`. Spec 161's review found the PV tables
missing from it, where a restore cascaded them away through `equipments`; the new
one must not repeat that.

## The rules, and their constants

| Constant                    | Value  | Why                                                   |
| --------------------------- | ------ | ----------------------------------------------------- |
| `MIDDAY_FROM` / `MIDDAY_TO` | 10, 16 | Measured: outside it the noise doubles                |
| `MIN_DIRECT_FRACTION`       | 0.75   | The knee of the measured table                        |
| `MIN_QUALIFYING_HOURS`      | 4      | A day of fewer hours is an opinion, not a measurement |
| `NORMAL_DAYS`               | 20     | Trailing qualifying days behind the reference         |
| `MIN_NORMAL_DAYS`           | 8      | Below it there is no normal and nothing is asserted   |
| `ALERT_MARGIN`              | 0.10   | Above the measured 4.3 % floor with room to spare     |
| `ALERT_DAYS`                | 3      | Consecutive qualifying days below the margin          |

`ALERT_MARGIN` is deliberately not the noise floor. At 3σ over three days the
floor says 7.5 %; alerting there would fire on the tail of ordinary variation
several times a season. Ten percent is still below one lost panel of eight
(12.5 %), which is the smallest fault worth waking someone for.

## The normal

The median of the trailing `NORMAL_DAYS` qualifying days, excluding the days
under assessment. Median rather than mean: one anomalous day should not move the
reference it is about to be judged against.

It follows soiling, which is the point, and it cannot follow a step, because a
step needs `ALERT_DAYS` days to enter the window and the alert fires first.

## Alerting

Through `system.alarm.raised` and `system.alarm.resolved`, which the notification
publishers and the zone activity feed already carry — including the resolution,
since #709. No new transport.

Raised once per equipment, not once per day. Resolved when a qualifying day comes
back above the margin.

## API

```
GET /api/v1/energy/pv-health/:equipmentId    (any authenticated user)
  200 {
    ratio, normal, hours,           // today's, or the last qualifying day's
    days: [{ day, ratio, hours }],  // the trailing series, for the chart
    qualifyingDaysRecently,         // what the detector has had to work with
    detection: { onePanelDays, oneInverterDays } | null,
    alert: { since, deficit } | null
  }
```

`detection` is computed from the _observed_ recent rate of qualifying days, not
from the summer figure. In a fortnight of overcast it reports a slow detector,
because that is what the household has.

## Files

| File                                             | Change                                                       |
| ------------------------------------------------ | ------------------------------------------------------------ |
| `migrations/027_pv_health.sql`                   | new                                                          |
| `src/energy/pv/pv-health.ts`                     | new — the rules, pure                                        |
| `src/energy/pv/pv-forecaster.ts`                 | store `direct_fraction`; run the daily check after the refit |
| `src/backup/backup-manager.ts`                   | `pv_health_day` in `BACKUP_TABLES`                           |
| `src/api/routes/energy.ts`                       | the route                                                    |
| `ui/src/components/equipments/PvHealthPanel.tsx` | new — the card                                               |

## What this does not do

No per-panel attribution, no new declaration, no second data source. The card
says so rather than leaving the household to infer it.
