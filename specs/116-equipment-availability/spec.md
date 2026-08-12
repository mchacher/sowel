# Spec 116 — Equipment availability propagation

## Context

When a physical device goes offline (power cut, network loss, plugin disconnection), Sowel's reactive pipeline stops at the device layer:

- The `Device` entity already has a `status: "online" | "offline" | "unknown"` field updated by the plugin (see [`DeviceManager.updateDeviceStatus`](../../src/devices/device-manager.ts)) and a `lastSeen` timestamp.
- The Devices list UI shows a colored dot (green / red / grey) reflecting that status.

But this signal **does not propagate** to the layers users actually look at:

- `Equipment` has no status field. The equipment cards show the last known value regardless of whether the underlying device is online.
- `EnergyAggregator` queries InfluxDB for the live `power` point with **no freshness check**: a Shelly meter that was cut at the breaker keeps showing its last value as live data with no indicator.
- `ZoneAggregator` averages temperatures and counts shutters from equipments whose data may be hours old.
- Dashboard widgets and zone widgets aggregate without distinguishing live equipments from stale ones.

The specific bug that triggered this spec: a Shelly Pro 3EM was hors-tension for 30+ minutes; the live energy graph kept displaying the last known value as if it was live data, with zero indication of staleness. The same pattern applies to any equipment whose device goes offline.

This is a dormant systemic gap. Two prior specs partially referenced it:

- Spec 062 (water valve) mentioned _"equipment shows as 'déconnecté' in UI, toggle disabled"_ → never implemented.
- Spec 115 (awning) referenced a _"stale badge (existing pattern for any equipment)"_ → the pattern does not exist.

## Goals

1. Derive an **`Equipment.status`** (`online | degraded | offline`) from the bound devices' availability, computed in memory at read time (no DB migration).
2. Flag each `DataBindingWithValue` as **stale** when its category is _streaming_ and the value has not been updated within the category's freshness window.
3. Make `EnergyAggregator` honor the freshness window for live power: a stale `power` binding must surface as a stale live value, not as the last cached number.
4. Make `ZoneAggregator` exclude offline equipments from numeric aggregations (averages, sums) and expose an `unavailableEquipments` counter so widgets can show a "X unavailable" hint.
5. Add a **stale / degraded / offline badge** in every user-facing surface that today shows equipment values: compact equipment row, equipment detail card, LiveEnergyPage, EnergyDataPanel, zone widgets, dashboard family widgets.
6. Emit a new `equipment.status.changed` event so the UI updates reactively without polling.
7. Document a **plugin contract** that requires each integration plugin to maintain `device.status` truthfully. This is the long-term fix for the 25% of prod devices currently mis-labeled `online` after weeks of silence.

## Non-Goals

- **No `device.lastSeen` generic timeout.** Investigated in design; rejected because battery-powered Zigbee endpoints (PIR, contact, water leak) can legitimately stay silent for days without being offline. A generic seuil produces too many false positives. Detection relies on `device.status` (plugin contract) + streaming-category timeouts (contextual). Plugins that mis-report `device.status` are bugs to fix at the plugin level, not to compensate in Sowel core.
- **No persistence of `equipment.status`.** Derived at read time inside `EquipmentManager.getByIdWithDetails` / `getAllWithDetails`, following the same pattern as `ZoneAggregatedData`. Avoids a stale denormalized column.
- **No staleness on event-based categories.** `motion`, `contact_door`, `contact_window`, `water_leak`, `smoke`, `action`, `light_state`, `light_brightness`, `light_color_temp`, `light_color`, `shutter_position`, `lock_state`, `gate_state`, `cover_state`, `runtime_daily`, `weather_condition`, `media_*`, `appliance_state` are pushed only on change; absence of update means nothing about device health. A motion sensor in an empty house is normal.
- **No new equipment type, no new data category, no new order category.** Additive metadata only.
- **No recipe-engine integration in v1.** Recipes keep reading whatever the bindings expose; they can be made stale-aware in a follow-up spec if needed. (Today a recipe firing on a stale value would be a real bug — but solving it is a separate exercise that depends on whether each recipe wants strict or lenient semantics.)
- **No retroactive backfill of `device.status` for plugins that already mis-report.** A Z2M device stuck at `online` for 49 days stays `online` until the plugin is fixed. The spec's plugin contract section flags this as a known prod issue with named offenders.
- **No new REST endpoint.** `GET /equipments` and `GET /equipments/:id` simply return the new `status` field in their existing payloads.
- **No equipment-level "auto-disable" or order blocking when offline.** Sending an order to an offline equipment still goes through the existing executeOrder path — the plugin handles its own offline behavior (may fail silently, may queue, may throw). UI may visually disable buttons for offline equipments but does not enforce it server-side.

## Functional Requirements

### FR1 — `EquipmentStatus` type + computed field

- Add `EquipmentStatus = "online" | "degraded" | "offline"` to `src/shared/types.ts`.
- Extend `EquipmentWithDetails` with:
  - `status: EquipmentStatus`
  - `statusReason?: { offlineDevices: string[], staleBindings: string[], offlineSince: string | null }` — populated only when status ≠ `online`, used by the UI tooltip.
- Compute the status in `EquipmentManager.getByIdWithDetails` and `getAllWithDetails`:
  - For each data binding, look up the source `Device.status` and the binding's `lastUpdated`.
  - Apply the derivation rules (FR3 below).

### FR2 — `DataBindingWithValue.stale` flag

- Extend `DataBindingWithValue` with `stale: boolean` (default `false`).
- Compute per binding: `stale = isStreamingCategory(category) AND (now - lastUpdated > STREAMING_TIMEOUT_MS[category])`.
- For non-streaming categories, `stale` is always `false` (event-based: absence of update is not anomaly).

### FR3 — Equipment status derivation rules

Let `N = total devices bound to the equipment` (counted by unique `deviceId` across its data + order bindings), `Noffline = devices with device.status === "offline"`, `Nstale = bindings where stale === true`, `Nstreaming = bindings with isStreamingCategory(category)`.

| Condition                                                                        | Status     |
| -------------------------------------------------------------------------------- | ---------- |
| `N === 0` (equipment has no device bindings)                                     | `offline`  |
| `Noffline === N` (all bound devices are offline)                                 | `offline`  |
| `Noffline > 0 OR Nstale > 0` (any device offline OR any streaming binding stale) | `degraded` |
| All other cases (all devices online AND no streaming binding stale)              | `online`   |

- Devices with `status === "unknown"` count as **online** for the purpose of status derivation (conservative: we have no evidence of failure). This matches today's UI semantics (grey dot ≠ red dot).
- `statusReason.offlineDevices` lists the **names** of offline devices.
- `statusReason.staleBindings` lists the binding **aliases** that are stale.
- `statusReason.offlineSince` = earliest `lastSeen` among offline devices, OR earliest `lastUpdated` among stale streaming bindings. Used by the UI for the "X ago" tooltip.

### FR4 — Streaming categories table

In `src/shared/constants.ts`:

```ts
/** Categories where the device pushes a value at regular intervals,
 *  even when unchanged. Absence of update = anomaly. */
export const STREAMING_CATEGORIES: ReadonlySet<DataCategory> = new Set([
  "power",
  "energy",
  "voltage",
  "current",
  "temperature",
  "temperature_outdoor",
  "humidity",
  "humidity_outdoor",
  "pressure",
  "luminosity",
  "co2",
  "voc",
  "noise",
  "battery",
  "setpoint",
  "pool_water_temperature",
  "pool_temperature_setpoint",
]);

/** Maximum age (ms) before a streaming binding is flagged stale. */
export const STREAMING_TIMEOUT_MS: Record<string, number> = {
  power: 2 * 60 * 1000, // 2 min — live electrical reads (metering equipments only)
  energy: 10 * 60 * 1000, // 10 min — cumulative counter
  voltage: 5 * 60 * 1000,
  current: 5 * 60 * 1000,
  temperature: 65 * 60 * 1000, // > Zigbee's 1 h max_report_interval
  temperature_outdoor: 65 * 60 * 1000,
  humidity: 65 * 60 * 1000,
  humidity_outdoor: 65 * 60 * 1000,
  pressure: 65 * 60 * 1000,
  luminosity: 65 * 60 * 1000,
  co2: 65 * 60 * 1000,
  voc: 65 * 60 * 1000,
  noise: 65 * 60 * 1000,
  battery: 2 * 60 * 60 * 1000, // 2 h — battery reports are sparse
  setpoint: 60 * 60 * 1000, // 1 h
  pool_water_temperature: 65 * 60 * 1000,
  pool_temperature_setpoint: 60 * 60 * 1000,
};

/** Electrical categories — only checked on METERING_EQUIPMENT_TYPES. */
export const ELECTRICAL_STREAMING_CATEGORIES = new Set(["power", "energy", "voltage", "current"]);
export const METERING_EQUIPMENT_TYPES = new Set([
  "energy_meter",
  "main_energy_meter",
  "energy_production_meter",
  "solar_panel",
]);

/** Default fallback for any future streaming category not yet listed above. */
export const DEFAULT_STREAMING_TIMEOUT_MS = 15 * 60 * 1000;
```

**Amendment — false positives on report-on-change devices.** The ambient windows
were 15–30 min in the original design, and the electrical ones applied to every
equipment type. Both turned healthy devices into permanently `degraded`
equipments:

- Zigbee sensors report on change, with `max_report_interval` conventionally set
  to 3600 s. Any window below that flags a healthy sensor as stale, so the
  ambient windows now sit at 65 min — a freshness window has to exceed the
  longest silence the device is _allowed_ to keep, not the typical one.
- Electrical categories are now checked **only on metering equipments**.
  Elsewhere they arrive as a bonus from a metering smart plug bound to a light or
  a switch, where silence means "steady load", not "fault". The live-energy case
  this spec was written for is unaffected: a Shelly Pro 3EM is a
  `main_energy_meter` and keeps its 2 min window.

Measured before the fix on a 33-equipment install: 180 `equipment.status.changed`
transitions in 64 minutes, six equipments toggling `online` ↔ `degraded` at every
reporting cycle, nothing actually wrong.

Categories NOT in `STREAMING_CATEGORIES` (motion, contact_door, contact_window, water_leak, smoke, action, light_state, light_brightness, light_color_temp, light_color, shutter_position, lock_state, gate_state, cover_state, runtime_daily, weather_condition, media_volume, media_mute, media_input, appliance_state, uv, solar_radiation, wind, rain, generic) → never stale, full stop.

### FR5 — EventBus: `equipment.status.changed`

- Add a new `EngineEvent` variant in `src/shared/types.ts`:

```ts
| { type: "equipment.status.changed"; equipmentId: string; oldStatus: EquipmentStatus; newStatus: EquipmentStatus }
```

- Emitted by `EquipmentManager` (or a dedicated `EquipmentStatusTracker` helper — see architecture.md) whenever an equipment's derived status changes.
- Forwarded to WebSocket clients via the existing `ws-server` event broadcast.
- Plumb the UI store (Zustand) to update `equipment.status` reactively.

### FR6 — EnergyAggregator: live power freshness

- When `EnergyAggregator` computes the live `power` value for the LiveEnergyPage (currently read directly from the binding), it must consult the binding's `stale` flag.
- If `power` is stale, the equipment's contribution to the live total is reported as `{ value: null, stale: true, lastUpdated }` rather than the cached number.
- The cumuls (hour / day / month / year) are NOT affected: they come from InfluxDB historical points and are inherently historical, not "live".

### FR7 — ZoneAggregator: exclusion + counter

In `src/zones/zone-aggregator.ts`:

- When iterating equipments to aggregate:
  - Equipments with `status === "offline"` → skip entirely (do not contribute to temperature averages, light counts, shutter counts, etc.).
  - Equipments with `status === "degraded"` → include with their last known values (degraded ≠ trust-broken; we just flag at the UI level).
- Add `unavailableEquipmentsByCategory: Record<string, number>` to `ZoneAggregatedData` — a per-category counter of equipments that were skipped because they were offline (e.g. `{ temperature: 1, light_state: 0 }`).
- Existing aggregated fields (`temperature`, `lightsOn`, etc.) reflect the **online + degraded** subset only.

### FR8 — UI: equipment cards (compact + detail)

- Add a `<EquipmentStatusBadge>` component in `ui/src/components/equipments/`:
  - `degraded` → ambre badge "Dégradé" / "Degraded" with `AlertTriangle` icon (Lucide, stroke 1.5).
  - `offline` → red badge "Déconnecté" / "Offline" with `WifiOff` icon.
  - `online` → no badge (default state, no visual noise).
- Render the badge:
  - In `CompactEquipmentCard` (zone view rows): top-right corner of the row.
  - In `EquipmentDetailCard` (detail page header): next to the equipment name.
- Add a tooltip on hover (desktop) / tap (mobile) showing:
  - Status (Online / Degraded / Offline)
  - For degraded/offline: list of offline devices + "Last seen X ago"
  - List of stale bindings with their `lastUpdated`

### FR9 — UI: LiveEnergyPage stale indicator

In `ui/src/components/energy/LiveEnergyPage.tsx`:

- If the `main_energy_meter` equipment's `power` binding is stale: replace the live power value with a greyed placeholder + a `AlertTriangle` icon, and show a small caption "Données non temps réel" / "Live data unavailable" with relative time.
- Same for `energy_production_meter` and any submeter widget.
- The historical chart (5-min, 1-day) is NOT affected: it reads from InfluxDB.

### FR10 — UI: EnergyDataPanel last-updated

- In `ui/src/components/equipments/EnergyDataPanel.tsx`: when any of the displayed cumuls is backed by a `power` binding that is stale, show a small "Last updated X ago" subtitle in greyed text. Existing layout untouched.

### FR11 — UI: zone widgets + dashboard family widgets

- `ZoneWidget` (zone aggregate widgets on dashboard) and `CompactZoneCard` (zone row in zone list):
  - If `unavailableEquipmentsByCategory[<relevant category>] > 0`, show a small "(X unavailable)" hint next to the count or the value.
  - Pattern: `<Thermometer /> 21.3 °C (1 unavailable)`, `<Lightbulb /> 3/5 on (1 unavailable)`.
- Dashboard family widgets (`ShuttersWidget`, `AwningsWidget`, `LightsWidget`, etc.): when any equipment in the family is offline, append a small warning badge to the widget header.

### FR12 — i18n strings (en + fr)

In `ui/src/i18n/locales/{en,fr}.json`:

- `equipment.status.online`: "Online" / "En ligne"
- `equipment.status.degraded`: "Degraded" / "Dégradé"
- `equipment.status.offline`: "Disconnected" / "Déconnecté"
- `equipment.status.tooltip.offlineDevices`: "{{count}} device(s) offline" / "{{count}} appareil(s) hors ligne"
- `equipment.status.tooltip.staleBindings`: "{{count}} stale value(s)" / "{{count}} valeur(s) périmée(s)"
- `equipment.status.tooltip.lastSeen`: "Last seen {{when}}" / "Vu pour la dernière fois {{when}}"
- `energy.live.unavailable`: "Live data unavailable" / "Données live indisponibles"
- `energy.live.lastUpdate`: "Last update {{when}}" / "Dernière donnée {{when}}"
- `zones.aggregate.unavailable`: "({{count}} unavailable)" / "({{count}} indisponible)"

`{{when}}` uses the existing relative-time helper (already used by `ElapsedCounter`).

### FR13 — Plugin contract documentation

Update [`docs/technical/plugin-development.md`](../../docs/technical/plugin-development.md) with a new mandatory section:

```markdown
## Device availability contract (mandatory)

Each plugin MUST keep `device.status` truthful — it is the single source of truth Sowel relies on to derive equipment availability (spec 116).

Required calls:

- `deviceManager.updateDeviceStatus(integrationId, sourceDeviceId, "online")` when the device starts responding (LWT topic switches to `online`, polling succeeds, etc.).
- `deviceManager.updateDeviceStatus(integrationId, sourceDeviceId, "offline")` when the device stops responding (LWT topic switches to `offline`, polling times out N times, plugin disconnects from its broker/cloud, etc.).

Plugins that fail this contract leave their devices stuck at `online` indefinitely, which makes equipments appear functional in the UI when they are not. This was the root cause of a real bug shipped in v1.13 (Shelly meter went offline at the breaker, graph kept showing last value as live).

Known offenders (to be fixed in their own plugin repos):

- `sowel-plugin-zigbee2mqtt`: must wire the Z2M `<friendlyName>/availability` topic to `updateDeviceStatus`. Currently 24 prod devices are stuck `online` after up to 49 days of silence.
- `sowel-plugin-mcz-maestro`: must call `updateDeviceStatus("offline")` when the Socket.IO connection drops or stays silent past the keepalive.

Audits of other plugins (panasonic-cc, smartthings, netatmo-\*) should follow.
```

Also update `docs/technical/api-reference.md` to document `equipment.status` in the `GET /equipments` response shape and the new WebSocket event.

### FR14 — Tests

Implementation tests are scoped in [plan.md](plan.md). At a high level:

- Unit tests for the status-derivation function (input: bindings + devices, output: `EquipmentStatus` + reason).
- Unit tests for the streaming-timeout helper (`isStaleBinding`).
- Unit tests for `EquipmentManager.getByIdWithDetails` exposing the computed status.
- Unit tests for `ZoneAggregator` skipping offline equipments and incrementing the counter.
- Unit tests for `EnergyAggregator` returning `{ stale: true }` when the power binding is stale.
- Unit test for the `equipment.status.changed` event being emitted on transitions.

## Acceptance Criteria

- [ ] FR1: `EquipmentWithDetails.status` is one of `online | degraded | offline` in every `GET /equipments` and `GET /equipments/:id` response.
- [ ] FR1: `statusReason` is present and populated when status ≠ `online`; absent when `online`.
- [ ] FR2: `DataBindingWithValue.stale` is `true` exactly when the category is streaming and `lastUpdated` exceeds the per-category timeout.
- [ ] FR3: Derivation rules verified by unit tests for the 6 main combinations (no bindings, all offline, one offline, all online + one stale, all online + all stale, fully healthy).
- [ ] FR4: `STREAMING_CATEGORIES` and `STREAMING_TIMEOUT_MS` are exported from `constants.ts`; event-based categories (motion, contact\_\*, action, etc.) are explicitly NOT in the set.
- [ ] FR5: `equipment.status.changed` event emitted on every status transition and forwarded over WebSocket.
- [ ] FR6: When the live `power` binding is stale, `EnergyAggregator` exposes `{ value: null, stale: true, lastUpdated }` for the live read.
- [ ] FR7: `ZoneAggregator` skips offline equipments in numeric aggregations and populates `unavailableEquipmentsByCategory`.
- [ ] FR8: `<EquipmentStatusBadge>` renders correctly for the 3 states; visible on compact + detail cards with tooltip.
- [ ] FR9: LiveEnergyPage shows the stale indicator when power is stale; otherwise no visual change.
- [ ] FR10: EnergyDataPanel shows "Last update X ago" caption when its source is stale.
- [ ] FR11: Zone widgets show the "(X unavailable)" hint when applicable.
- [ ] FR12: All new i18n keys present in `en.json` + `fr.json`.
- [ ] FR13: `plugin-development.md` updated; `api-reference.md` documents the new status field + event.
- [ ] FR14: All new unit tests pass; existing tests still pass.
- [ ] `npx tsc --noEmit` clean (backend + UI).
- [ ] `npx vitest run` clean.
- [ ] `npx eslint src/ --ext .ts` clean.
- [ ] Manual validation: temporarily mark a device offline (via API or by stopping a plugin), verify the equipment cards, energy widgets, and zone widgets reflect the state within 1 s (WS round-trip).
- [ ] Documentation: `docs/release-notes.{md,fr.md}` entry added when bundled into a release (per spec 108).

## Edge Cases

- **Equipment with order bindings only, no data bindings**: status derived from order-binding source devices. Same rules apply.
- **Equipment with bindings to multiple devices, half offline**: status = `degraded`. UI tooltip lists which devices.
- **Plugin restart / Sowel restart**: `device.status` is loaded from SQLite at boot. If the plugin doesn't re-poll quickly, status may briefly be stale (e.g. last persisted value). Status will refresh as soon as the plugin emits `updateDeviceStatus` for the first time. Acceptable: equipment status will catch up within seconds.
- **Streaming binding never received a value** (`lastUpdated === null`): treated as **not stale** (we never had any value to begin with; the binding is fresh-but-empty, not silent). Avoids marking newly-created equipments as degraded.
- **Equipment with computed data only** (e.g. energy cumuls, no underlying device data binding for those values): the equipment's status is derived from its actual device-backed bindings only. Computed entries are not part of the staleness check.
- **`device.status === "unknown"`**: treated as online (conservative — no evidence of failure). Matches the existing grey-dot semantics in the Devices list.
- **`shutter_position` is intentionally event-based**: a shutter that hasn't moved in 3 weeks is fine. A shutter equipment's status follows the device's `status` (LWT-based). If the device goes offline, the equipment is `offline` — but no stale-on-shutter_position check.
- **Battery binding stale (2h timeout)**: a battery-powered Zigbee endpoint that hasn't sent a battery report in 2h is genuinely worth flagging. Reasonable across Aqara/Tuya/Sonoff defaults.
- **Order issued to an offline equipment**: passes through the existing `executeOrder` flow. The plugin may fail to deliver (offline LWT) — that's its concern. UI may grey-out the button using `equipment.status === "offline"`, but does not block the call server-side.
- **i18n missing key fallback**: react-i18next falls back to the key string (existing convention).

## Related

- Direct trigger: bug Shelly Pro 3EM coupé au tableau, graph live figé sans indicateur.
- Spec 062 (water_valve): referenced "déconnecté" UI semantics — never delivered, this spec covers it.
- Spec 115 (awning): referenced "stale badge (existing pattern)" — this spec creates that pattern.
- Spec 111 (plugin soft isolation): defines the `system.integration.{connected,disconnected}` event pair already in use. We layer the **equipment**-level signal on top of the existing device-level one.
- Future spec (out of scope): recipe staleness awareness — make recipes optionally refuse to fire on stale triggers. Today's behavior: recipes still fire on whatever the binding exposes.
- Future spec (out of scope): per-device "liveness watchdog" for plugins that can't or won't implement `updateDeviceStatus` (e.g. fire-and-forget LoRa receivers). Could be opt-in per device.
