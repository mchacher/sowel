# Plan — Equipment availability propagation

## Implementation order

Follow the standard Sowel order (types → constants → core logic → backend integration → tests → API/WS → UI). Each step is independently committable; the whole feature ships in one PR.

### Step 1 — Types & constants

- [ ] Add `EquipmentStatus`, `EquipmentStatusReason` to `src/shared/types.ts`.
- [ ] Extend `DataBindingWithValue` with `stale: boolean`.
- [ ] Extend `EquipmentWithDetails` with `status` + optional `statusReason`.
- [ ] Extend `ZoneAggregatedData` with `unavailableEquipmentsByCategory`.
- [ ] Add `equipment.status.changed` variant to the `EngineEvent` union.
- [ ] Add `STREAMING_CATEGORIES`, `STREAMING_TIMEOUT_MS`, `DEFAULT_STREAMING_TIMEOUT_MS` to `src/shared/constants.ts`.
- [ ] `npx tsc --noEmit` clean after this step (compilation may fail in downstream files — fix in the next steps as they reference the new fields).

### Step 2 — Core logic (`src/equipments/equipment-status.ts`)

- [ ] Create `equipment-status.ts` with `isStaleBinding` + `deriveEquipmentStatus` pure functions.
- [ ] Create `equipment-status.test.ts` alongside it. Cover the matrix below.

### Step 3 — EquipmentManager wiring

- [ ] In `equipment-manager.ts`:
  - Annotate `DataBindingWithValue` rows with `.stale` in `getDataBindingsWithValues`.
  - Add `resolveDevicesForBindings(dataBindings, orderBindings): Map<bindingId, Device>` helper.
  - Extend `getByIdWithDetails` + `getAllWithDetails` to call `deriveEquipmentStatus` and include `status` + `statusReason` in the response.
- [ ] Update `equipment-manager.test.ts` to assert the new fields on the returned shape.

### Step 4 — Status tracker (`src/equipments/equipment-status-tracker.ts`)

- [ ] Create `EquipmentStatusTracker` class (constructor + `start` + `recompute` + debounce).
- [ ] Subscribe to `device.status_changed`, `device.data.updated`, `equipment.bindings.changed`.
- [ ] Add a 60 s wallclock tick (`setInterval(...).unref()`) to catch staleness transitions when no event fires.
- [ ] Emit `equipment.status.changed` on transition.
- [ ] Wire in `src/index.ts` after `EquipmentManager` is started.
- [ ] Create `equipment-status-tracker.test.ts`.

### Step 5 — EnergyAggregator + ZoneAggregator

- [ ] `EnergyAggregator`: no functional change in this file if live power is read frontend-side from `equipment.dataBindings[].stale`. Verify; if a backend `/energy/live` endpoint exists, mirror the `stale` flag there.
- [ ] `ZoneAggregator`: skip offline equipments in aggregation; populate `unavailableEquipmentsByCategory`.
- [ ] Update `zone-aggregator.test.ts` with new scenarios.

### Step 6 — WebSocket plumbing

- [ ] In `src/api/ws-server.ts` (or wherever events are forwarded), ensure `equipment.status.changed` is broadcast to authenticated clients.
- [ ] Verify no event-type filter blocks the new variant.

### Step 7 — Documentation

- [ ] Add the "Device availability contract" mandatory section to `docs/technical/plugin-development.md`.
- [ ] Update `docs/technical/api-reference.md`:
  - `GET /equipments` response shape: `status`, `statusReason`.
  - `GET /zones/:id/aggregated` response shape: `unavailableEquipmentsByCategory`.
  - WebSocket events: new `equipment.status.changed` event.
- [ ] Update `docs/specs-index.md` with the new spec entry under a new "V1.14 — availability propagation" section.

### Step 8 — Frontend store + types

- [ ] Sync `ui/src/types.ts` (if shared types are duplicated UI-side) with backend changes.
- [ ] In `ui/src/stores/equipments.ts`: handle `equipment.status.changed` to update the equipment in-place.

### Step 9 — Frontend components

- [ ] Create `ui/src/components/equipments/EquipmentStatusBadge.tsx` (size variants for compact / detail).
- [ ] Mount in `CompactEquipmentCard.tsx` (top-right corner).
- [ ] Mount in `EquipmentDetailCard.tsx` (next to name).
- [ ] `LiveEnergyPage.tsx`: extend `sumPower` to collect stale flags; render the "Live data unavailable" HUD when any contributing binding is stale.
- [ ] `EnergyDataPanel.tsx`: subtitle "Last update X ago" when source binding is stale.
- [ ] `ZoneWidget.tsx` / `CompactZoneCard.tsx`: append "(X unavailable)" hint when relevant.
- [ ] Dashboard family widgets (`ShuttersWidget`, `AwningsWidget`, `LightsWidget`, etc.): append warning badge to header when any equipment in family is offline.

### Step 10 — i18n

- [ ] Add all FR12 keys to `ui/src/i18n/locales/en.json` + `fr.json`.

### Step 11 — Validation

- [ ] `npx tsc --noEmit` clean.
- [ ] `cd ui && npx tsc --noEmit` clean.
- [ ] `npx vitest run` — all tests pass.
- [ ] `npx eslint src/ --ext .ts` clean.
- [ ] Manual validation in dev:
  - Stop a plugin → its devices should turn `offline` (assuming the plugin calls `updateDeviceStatus` on shutdown).
  - Manually mark a device offline via `PUT /devices/:id/status` (admin only, if available — else via `sqlite3 UPDATE`).
  - Verify the equipment card shows the badge, the LiveEnergyPage shows the warning HUD, the zone widget shows the count.
  - Restart the plugin → equipment status returns to online within 1 s of the next data push.
- [ ] Release notes entry in `docs/release-notes.{md,fr.md}` (per spec 108) when bundling into a versioned release.

---

## Test Plan

### Modules to test

| Module                        | New file?                               | What it covers                                               |
| ----------------------------- | --------------------------------------- | ------------------------------------------------------------ |
| `equipment-status.ts`         | New: `equipment-status.test.ts`         | Pure derivation logic + `isStaleBinding`                     |
| `equipment-manager.ts`        | Extend: `equipment-manager.test.ts`     | `status` field on `getByIdWithDetails` / `getAllWithDetails` |
| `equipment-status-tracker.ts` | New: `equipment-status-tracker.test.ts` | Event emission on transitions, debouncing                    |
| `zone-aggregator.ts`          | Extend: `zone-aggregator.test.ts`       | Offline-equipment exclusion + counter population             |

### Scenarios

#### `equipment-status.test.ts`

| Scenario                                                                            | Expected                                                                                       |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `isStaleBinding("motion", "2026-05-01")` (event-based, very old)                    | `false` — event-based categories are never stale                                               |
| `isStaleBinding("power", "2026-05-24T10:00:00Z")` with now = 2026-05-24T10:01:00Z   | `false` — within 2 min window                                                                  |
| `isStaleBinding("power", "2026-05-24T10:00:00Z")` with now = 2026-05-24T10:05:00Z   | `true` — exceeds 2 min                                                                         |
| `isStaleBinding("temperature", null)`                                               | `false` — never updated ≠ stale                                                                |
| `isStaleBinding("contact_door", "2025-01-01")`                                      | `false` — event-based, never stale                                                             |
| `isStaleBinding("battery", 3h ago)` with timeout 2h                                 | `true`                                                                                         |
| Unknown future category not in `STREAMING_TIMEOUT_MS` but in `STREAMING_CATEGORIES` | Uses `DEFAULT_STREAMING_TIMEOUT_MS`                                                            |
| `deriveEquipmentStatus([], new Map())` (no bindings)                                | `{ status: "offline", reason: { offlineDevices: [], staleBindings: [], offlineSince: null } }` |
| 1 binding, device online, fresh                                                     | `{ status: "online", reason: null }`                                                           |
| 1 binding, device offline                                                           | `{ status: "offline", offlineDevices: ["device-name"] }`                                       |
| 2 bindings on 2 devices, 1 device offline                                           | `{ status: "degraded", offlineDevices: ["one"] }`                                              |
| 2 bindings on 2 devices, both offline                                               | `{ status: "offline", offlineDevices: ["one", "two"] }`                                        |
| 2 bindings same device online, 1 binding streaming stale                            | `{ status: "degraded", staleBindings: ["binding-alias"] }`                                     |
| 2 bindings same device online, both streaming fresh                                 | `{ status: "online" }`                                                                         |
| Device with `status: "unknown"` (treated as online) + no stale bindings             | `{ status: "online" }`                                                                         |
| Device with `status: "unknown"` + 1 stale streaming binding                         | `{ status: "degraded" }`                                                                       |
| `offlineSince` is the **earliest** of all offending timestamps                      | Verified for mixed offline-device + stale-binding case                                         |

#### `equipment-manager.test.ts` (extensions)

| Scenario                                                                        | Expected                                                          |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `getByIdWithDetails(equipmentId)` for an equipment with one online device       | Returned object has `status: "online"`, no `statusReason`         |
| `getByIdWithDetails(equipmentId)` for an equipment with offline device          | Returned object has `status: "offline"`, `statusReason` populated |
| `getAllWithDetails()` mixes online + offline + degraded equipments              | Each has correct `status`                                         |
| `DataBindingWithValue.stale` is `true` for a power binding older than 2 min     | Yes                                                               |
| `DataBindingWithValue.stale` is `false` for a motion binding older than 30 days | Yes                                                               |

#### `equipment-status-tracker.test.ts`

| Scenario                                                                                                      | Expected                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Start with all equipments online, fire `device.status_changed` (offline) for a bound device                   | `equipment.status.changed` emitted with `oldStatus: "online"`, `newStatus: "offline"` (or `"degraded"` depending on bindings) |
| Same transition triggers only one event even if multiple device events arrive within debounce window (200 ms) | Single emission                                                                                                               |
| No transition (status stays online) → no event emitted                                                        | No call to `eventBus.emit("equipment.status.changed", ...)`                                                                   |
| Streaming binding crosses staleness threshold during wallclock tick (60 s recompute)                          | `equipment.status.changed` emitted with `newStatus: "degraded"` (or `offline`)                                                |
| Equipment back online after device reconnects                                                                 | `equipment.status.changed` emitted with `newStatus: "online"`                                                                 |

#### `zone-aggregator.test.ts` (extensions)

| Scenario                                                                                      | Expected                                                                                     |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Zone with 3 temperature sensors, 1 offline → average                                          | Average uses 2 sensors; `unavailableEquipmentsByCategory.temperature === 1`                  |
| Zone with 2 lights, 1 offline → counts                                                        | `lightsOn` counts only the online light; `unavailableEquipmentsByCategory.light_state === 1` |
| Zone with all equipments online                                                               | `unavailableEquipmentsByCategory === {}`                                                     |
| Zone with degraded equipment (has stale binding but device online) → still counted in average | Degraded equipments contribute; no counter increment                                         |

### What is NOT tested

- UI components (no React tests in this project — existing convention).
- Database CRUD (`Equipment.status` is derived, not stored — nothing to test at DB layer).
- The `device.status_changed` event itself (already tested in `device-manager.test.ts`).
- Plugin-side compliance with the "Device availability contract" — that's verified in each plugin's own repo (separate issue track per plugin).

### Manual validation matrix (FR + UI)

| Surface                | How to validate                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| Equipment compact card | Stop the Shelly plugin → ambre badge appears on the Shelly equipment row within 1 s                           |
| Equipment detail card  | Open the equipment → badge next to name, tooltip shows offline devices                                        |
| LiveEnergyPage         | Stop a `main_energy_meter`'s plugin → warning HUD replaces live power within 2 min                            |
| EnergyDataPanel        | Same as above → "Last update X ago" caption                                                                   |
| Zone widget            | Mark one equipment offline → "(1 unavailable)" hint appears                                                   |
| Dashboard family       | Offline equipment in family → warning badge on widget header                                                  |
| WebSocket reactivity   | Watch the browser DevTools network panel → `equipment.status.changed` arrives, UI updates without page reload |
