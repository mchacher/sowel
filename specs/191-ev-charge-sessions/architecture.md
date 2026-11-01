# Architecture — Spec 191

## Flow diagram

```
Charger plugin ──► device.data.updated ──► EquipmentManager
                                               │ equipment.data.changed
            ┌──────────────────────────────────┼──────────────────────────────┐
            ▼                                  ▼                              ▼
  ev_charger: vehicle / power / energy   main_energy_meter: energy     electric_vehicle: plugged,
            │                            (signed grid delta, live)     charging_state, battery_level,
            ▼                                  │                       at_home, mileage (+ reported_at)
  ┌──────────────── EvSessionTracker (src/energy/ev-sessions/) ──────────────────────┐
  │ per charger: open session (FR1)                                                  │
  │ per session: WindowAccountant → 5-min windows → settleWindow() (FR2)             │
  │ per session: VehicleEvidence per vehicle → attribute() at grace end (FR3)        │
  │ per vehicle: driving leg (onMileage / onBattery / onCharging) (FR5)              │
  │ 30 s tick: close due windows, decide sessions whose grace is over                │
  └───────────────┬───────────────────────────────────────────────┬──────────────────┘
                  ▼                                               ▼
        EvSessionStore (SQLite)                      EventBus: energy.ev_session.updated
        ev_charge_sessions                                     energy.ev_session.deleted
        ev_vehicle_daily_driving                                   │ (topic `energy`)
        ev_vehicle_leg_state                                       ▼
                  ▲                                     WebSocket → useEvSessions.rev → sections refetch
                  │
      REST /api/v1/ev-sessions (list, summary, attribution)
```

The tracker listens to live `equipment.data.changed` only, never to InfluxDB: sessions work without InfluxDB, and the raw bucket's 7-day retention never limits a long session. It reads the main meter's **signed grid delta** as the plugin emits it (the same input as `SelfConsumptionWriter`), not the household series that writer produces, and only live ticks (no `sourceTimestamp`).

## Components

All new, under `src/energy/ev-sessions/`.

### `window-accountant.ts` (pure)

`WindowAccountant` accumulates one open session in 5-minute windows aligned on the clock:

- `power(at, W)`: the charger's power, **held** until the next reading (a charger may report only on change), and held at most 15 minutes after the charger's last report of any kind (`HOLD_LIMIT_MS`), so an offline charger stops counting.
- `carEnergy(at, Wh)`: an energy delta. Used as the car's draw only for a charger that never reported a power in the session; once one did, power alone measures the windows, so a late energy tick is never counted twice.
- `grid(at, Wh)`: a live main-meter delta; the window sums `max(0, delta)` and remembers whether it saw any tick.
- `advance(at)` / `finish(at)`: return the `WindowMeasure`s that closed (`startS`, `lengthS`, `carWh`, `importWh | null`). Windows with no draw are skipped.

`settleWindow(measure, { hasMainMeter, hcShare, prices })` prices one window: `grid = min(car, import)` (P5); without a main meter or without a grid tick, `import = car` (never invent solar); the grid part is split by `hcShare` and priced, or `null` without a tariff.

The tracker gets `hcShare` from `TariffClassifier.classify(1_000_000, startS, lengthS)` (a large total, so the classifier's rounding to whole Wh does not distort a small window) and the prices from `TariffClassifier.getConfig()` (configured when HP or HC > 0, as on `/energy/history`).

### `attribution.ts` (pure)

`VehicleEvidence` per vehicle: `pluggedSeen`, `unpluggedSeen`, `chargingSeen`, `awaySeen`, `firstBattery`, `maxBattery`. `foldReport()` folds one report when the car made it **during** the session: its `reported_at` when it has one, else the time Sowel received it, must fall in `[start, end]` (end = ∞ while open). The grace period only gives late reports time to arrive.

`matches(e)`: never seen away nor unplugged, and seen charging or a battery rise of at least 2 points (`BATTERY_RISE_POINTS`, jitter below). `attribute(evidence, vehicleIds)`: one match → `vehicle` (`single-match`); several → `unattributed` (`several-matches`); none → the only vehicle when there is just one and it was not seen away or unplugged (`only-vehicle`), else `unattributed` (`no-match`). Evidence of a vehicle that no longer exists is ignored.

A car's report reaches Sowel as several updates in one burst, `reported_at` among them in any order: the tracker reads `reported_at` in a microtask, once the burst is over.

### `driving.ts` (pure)

A leg runs from one `mileage` reading to the next. `onBattery` tracks the lowest level and flags `charged` on a rise of 2 points or more; `onCharging` flags it when the car reports `charging`. `onMileage` closes the leg: `kmTotal`, and when the leg was not charged and the battery did not rise, `kmMeasured` and `batteryDrop`. A reading with no km starts a fresh leg, so a car parked and charged between two readings does not spoil the next drive. A mileage going backwards is ignored.

### `summary.ts` (pure)

- `deriveEnergy(sums)`: `k = energy_wh / est_car_wh` scales the window estimates to the meter (energy = estimate for a charger without an energy meter; all grid when the meter moved without any estimate).
- `whPerBatteryPoint(sessions)`: Σ energy ÷ Σ battery rise over the 10 most recent attributed sessions that raised the battery by at least 10 points.
- `monthSummary(...)`: totals, `homePriceEurPerKwh = cost ÷ energy`, `kWhPer100km = whPerPoint × Σ batteryDrop ÷ Σ kmMeasured ÷ 10`, `eurPer100km = homePrice × kWhPer100km`, or a reason: `plug-in-hybrid`, `no-home-session`, `not-learned`, `too-few-km` (< 50 measured km).

### `ev-session-store.ts`

better-sqlite3 prepared statements. The tracker saves a whole `SessionRecord` at each change (upsert). `toSession()` derives the API shape, including `candidates` (what each vehicle reported, shown in the reassignment sheet).

### `ev-session-tracker.ts`

- **Open / close** on the charger's `vehicle` (category `ev_vehicle_state`). Offline is not unplugged.
- **Close**: `finish()` the accountant (the partial last window is priced over its real length), `endedAt`, `graceUntil = end + 2 h`; under 100 Wh the session is deleted (`energy.ev_session.deleted`); a manual attribution skips the grace period.
- **Tick** every 30 s: close due windows (so a window is priced at the prices in force when it ended), decide sessions whose grace is over.
- **Start**: open sessions are restored; one whose charger is gone or reads `disconnected` is closed now; one still plugged continues with a fresh accountant (the window in progress is the most a restart loses). Closed sessions still `pending` are restored with their evidence. A charger already plugged without a session opens one.
- **`equipment.removed`**: a charger's open session is closed and kept; a vehicle's sessions are marked `vehicle_deleted` (they keep the name and count nowhere) and its leg state is dropped.
- **`setAttribution()`** (FR4): `vehicle` (must be an `electric_vehicle`), `other`, or `unattributed`, always `attribution_source = manual`, never changed again by FR3.
- **Read surface**: `listByCharger`, `listByVehicle` (attributed, vehicle not deleted), `summary` (closed sessions only).
- Every handler is wrapped in try/catch with a structured log.

### Migration `038_ev_charge_sessions.sql`

`ev_charge_sessions` (meter, window sums, cost per tariff, attribution with source and reason, battery start / end, evidence JSON), `ev_vehicle_daily_driving` (km total, km measured, battery drop per vehicle and local day), `ev_vehicle_leg_state` (the open leg of each vehicle), and `equipments.plug_in_hybrid`.

### Types — `src/shared/types.ts`

`EvChargeSession` (with `EvSessionCandidate[]`), `EvSessionAttribution` (`pending | vehicle | unattributed | other`), `EvSessionAttributionReason`, `EvVehicleMonthSummary`, `EvPer100kmUnavailable`, `Equipment.plugInHybrid`, and two events on the `energy` topic:

```ts
| { type: "energy.ev_session.updated"; session: EvChargeSession }
| { type: "energy.ev_session.deleted"; sessionId: string; chargerId: string }
```

`energy.ev_session.updated` is deduplicated per session in a WebSocket batch.

### API — `src/api/routes/ev-sessions.ts`

| Method | Path                                                         | Role | Purpose                                                                                 |
| ------ | ------------------------------------------------------------ | ---- | --------------------------------------------------------------------------------------- |
| GET    | `/api/v1/ev-sessions?chargerId=…\|vehicleId=…&month=YYYY-MM` | any  | Sessions of a charger, or attributed to a vehicle, for a month                          |
| GET    | `/api/v1/ev-sessions/summary?vehicleId=…&month=YYYY-MM`      | any  | FR5 summary                                                                             |
| PUT    | `/api/v1/ev-sessions/:id/attribution`                        | any  | `{ target: "vehicle", vehicleId }`, `{ target: "other" }`, `{ target: "unattributed" }` |

The attribution body is one flat schema rather than a `oneOf`: Fastify's validator removes additional properties branch by branch, and a `oneOf` stripped `vehicleId` before the handler (caught by the route test). The PUT is on the standard-user write allowlist (`src/auth/auth-middleware.ts`). `plugInHybrid` is set through `PUT /api/v1/equipments/:id` (admin), like `separateSupply`.

### UI

- `ui/src/api/evSessions.ts`, `ui/src/store/useEvSessions.ts` (a `rev` bumped, debounced, by the two WebSocket events), routing in `useWebSocket.ts`.
- `ui/src/components/equipments/ev-sessions/`: `EvHomeChargingSection` (vehicle page, variant B: cost and kWh, off-peak / peak / solar bar with kWh and € per part, cost per 100 km with consumption and home price, sessions with mini bars, the admin "plug-in hybrid" switch), `EvChargerSessionsSection` (charger page: "to attribute" banner, sessions with their vehicle chip and how it was decided, every row opens the sheet), `EvReassignSheet` (bottom sheet on a phone, dialog on a wide screen; the reason Sowel could not decide; each car's battery during the session; vehicles, Other vehicle, Attribute later; the choice is final), `EvMonthNav`, `evSessionsDisplay.ts` (pure helpers).
- Mounted in `EquipmentDetailPage.tsx` after the vehicle and charger controls. Both sections subscribe to `equipments` + `energy`.
- i18n `equipments.evSessions.*`, FR and EN.

## Files changed

| Domain | File                                                                                                                              | Change                                                    |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Types  | `src/shared/types.ts`, `ui/src/types.ts`                                                                                          | Session types, summary, events, `plugInHybrid`            |
| DB     | `migrations/038_ev_charge_sessions.sql`                                                                                           | Three tables, one column                                  |
| Energy | `src/energy/ev-sessions/*` (new)                                                                                                  | Accountant, attribution, driving, summary, store, tracker |
| Equip. | `src/equipments/equipment-manager.ts`, `src/api/routes/equipments.ts`                                                             | `plugInHybrid` read / write                               |
| Core   | `src/index.ts`                                                                                                                    | Construct, start, stop (shutdown) the tracker             |
| API    | `src/api/routes/ev-sessions.ts` (new), `src/api/server.ts`                                                                        | Routes                                                    |
| Auth   | `src/auth/auth-middleware.ts`                                                                                                     | Attribution PUT open to standard users                    |
| WS     | `src/api/websocket.ts`, `ui/src/store/useWebSocket.ts`                                                                            | Dedup key, routing to `useEvSessions`                     |
| UI     | `ui/src/components/equipments/ev-sessions/*`, `ui/src/api/*`, `ui/src/store/useEvSessions.ts`, `EquipmentDetailPage.tsx`, locales | Sections and sheet                                        |
| Docs   | see the spec's Docs Delta                                                                                                         |                                                           |

## Follow-up outside this repo

- `sowel-plugin-renault`: chargingStatus 0.4 (charge flap open) was mapped to `unplugged` even when `plugStatus = 1` (seen on the Megane on 2026-11-01) — issue mchacher/sowel-plugin-renault#5, fix in PR #6. Not a blocker here: a battery rise still attributes the session.
