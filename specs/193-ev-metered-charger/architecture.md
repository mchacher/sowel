# Spec 193 — Architecture

## Data

### Migration `040_ev_usual_vehicle.sql`

```sql
ALTER TABLE equipments ADD COLUMN usual_vehicle_id TEXT;
```

A plain column, not a foreign key, as with `plug_in_hybrid` (spec 191).

### Types — `src/shared/types.ts`

- `Equipment.usualVehicleId?: string`, present only when set.
- `EvSessionAttributionReason` gains `"usual-vehicle"`.

## Backend

### `src/shared/ev-charger-contract.ts`

- `METERED_CHARGER_THRESHOLD_W = 500` and `METERED_SESSION_END_MS = 30 min`.
- `isMeteredChargerDevice(data)`: has a `power` reading and is not `isEvChargerDevice`.

### `attribution.ts` (pure)

- `attribute(evidence, vehicleIds, usualVehicleId?: string | null)`: one more branch in the `matching.length > 1` case.

### `ev-session-tracker.ts`

- `OpenSession` gains `metered: boolean` (no `vehicle` binding at open) and `lastActiveMs`.
- `onCharger()`, for a metered charger:
  - `power` ≥ threshold opens a session when none is open (before accounting the reading), and sets `lastActiveMs`;
  - the `vehicle` alias is never seen, so FR1 of spec 191 never fires.
- `tick()`: a metered session with `now − lastActiveMs ≥ 30 min` closes. The accounting is finished at `now`; `endedAt` and `graceUntil` are set from `lastActiveMs`.
  - `close(chargerId, accountingEndMs, endedAtMs = accountingEndMs)`: one more parameter.
- `restore()`: per FR2. Opening "a charger already plugged" also covers a metered charger whose power is at 500 W or more.
- `resolve(record)`: one function used by `decide()` and `currentForVehicle()`.
  - It drops the cars given by overlapping sessions on other chargers (FR4). Those come from the open and pending records in memory, plus the store's attributed sessions in the range: `store.listOverlapping(chargerId, startIso, endIso)`.
  - Then it calls `attribute()` with this charger's usual vehicle.
- `onRemoved(vehicle)`: `equipmentManager.clearUsualVehicle(vehicleId)`.

### `ev-session-store.ts`

- `listOverlapping(excludeChargerId, fromIso, toIso)`: sessions on other chargers with `started_at < toIso AND (ended_at IS NULL OR ended_at > fromIso)`.

### `equipment-manager.ts` and `routes/equipments.ts`

- `usualVehicleId` is read, written and validated:
  - the equipment must be an `ev_charger`;
  - the id must be an `electric_vehicle`, or `null` to clear it.
- `clearUsualVehicle(vehicleId)`.

## UI

- `DeviceSelector.tsx`: for `ev_charger`, the compatible list becomes the chargers, then the `isMeteredChargerDevice` devices, each marked « metered only ». The binding plan is unchanged: the contract maps `power` and `energy` (the first `energy` reading keeps the alias).
- `EvChargerSessionsSection.tsx`: the **Usual vehicle** select (admin), saved through `updateEquipment`; the `usual-vehicle` reason.
- `evSessionsDisplay.ts` `liveState`: `vehicle` null and `powerW` known → charging (≥ threshold) or paused with `reason: null`. `PauseReason | null` in the paused variant.
- `EvCurrentSessionCard.tsx`: no reason line when `reason` is null.
- i18n FR/EN.

## Files changed

| File                                                                            | Change                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------ |
| `migrations/040_ev_usual_vehicle.sql`                                           | column                                     |
| `src/shared/types.ts`, `src/shared/ev-charger-contract.ts`                      | types, constants, `isMeteredChargerDevice` |
| `src/energy/ev-sessions/attribution.ts` (+ test)                                | usual-vehicle tie-break                    |
| `src/energy/ev-sessions/ev-session-tracker.ts` (+ test)                         | metered sessions, `resolve()`, FR4         |
| `src/energy/ev-sessions/ev-session-store.ts`                                    | `listOverlapping`                          |
| `src/equipments/equipment-manager.ts`, `src/api/routes/equipments.ts` (+ tests) | `usualVehicleId`                           |
| `ui/src/components/equipments/DeviceSelector.tsx`, `EquipmentForm.tsx`          | metered group, no default class            |
| `ui/src/components/equipments/ev-sessions/*`                                    | select, reason, live state                 |
| `ui/src/i18n/locales/{fr,en}.json`                                              | keys                                       |
| docs (see spec)                                                                 |                                            |
