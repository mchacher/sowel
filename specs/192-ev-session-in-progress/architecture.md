# Spec 192 — Architecture

## Backend

### `ev-session-tracker.ts`

- `currentForVehicle(vehicleId): EvChargeSession[]` — over the open records and the pending ones (in memory): manual + open + `vehicleId` match; else no manual choice and `attribute(evidence, enabled vehicle ids)` gives `vehicleId`. Sorted by `startedAt` descending.
- `foldInto()` calls `persist()` (save + `energy.ev_session.updated`) instead of `store.save()`, so the UI learns when a car starts to match.

The vehicle-id list used by `decide()` and `currentForVehicle()` comes from one helper, so the preview and the decision agree.

### `src/api/routes/ev-sessions.ts`

`GET /api/v1/ev-sessions/current` — querystring `{ vehicleId }` (required), returns `{ sessions }`. Read route: no allowlist change.

## UI

- `ui/src/api/evSessions.ts` — `getEvCurrentSessions(vehicleId)`.
- `evSessionsDisplay.ts` — pure `liveState(session, charger, vehicle)`: `charging` (with power) / `paused` (since, reason `charger-off` | `charge-limit` | `waiting-vehicle` | null) / `ended`.
- `EvCurrentSessionCard.tsx` — the three cards; reads the charger and the car from `useEquipments` (already live on the page through the `equipments` topic); the button calls `setEvSessionAttribution`.
- `EvHomeChargingSection.tsx` — fetches the current sessions with the month (same `rev`), renders the cards above the month card, and leaves their ids out of the session list.
- i18n `equipments.evSessions.current.*` FR/EN.

## Files changed

| File                                                | Change                                     |
| --------------------------------------------------- | ------------------------------------------ |
| `src/energy/ev-sessions/ev-session-tracker.ts`      | `currentForVehicle`, evidence change emits |
| `src/energy/ev-sessions/ev-session-tracker.test.ts` | scenarios below                            |
| `src/api/routes/ev-sessions.ts` (+ test)            | `current` route                            |
| `ui/src/api/evSessions.ts`                          | client                                     |
| `ui/src/components/equipments/ev-sessions/*`        | card, live state, section                  |
| `ui/src/i18n/locales/{fr,en}.json`                  | keys                                       |
| docs (see spec)                                     |                                            |
