# Spec 143 — Architecture

## Component

One new module, `src/devices/battery-monitor.ts`, in the same family as
`EquipmentStatusTracker` / `OrderConfirmationTracker`: an event subscriber with a
timer, owning a small persisted table, emitting system alarms. It reads through
`DeviceManager` and never writes device data.

```
device.data.updated ─┐
                     ├─► BatteryMonitor.evaluate(dataId)
sweep timer (6 h) ───┘        │
                              ├─ persist / delete battery_alerts row
                              └─ emit system.alarm.raised | resolved
                                        │
                                        ├─► NotificationPublishService.sendSystemAlarm
                                        │      └─► every enabled publisher (fixed here)
                                        └─► WebSocket ─► UI alarms map ─► issue banner
```

## Data model

Migration `017_battery_alerts.sql` — the alert table plus the power source
column:

```sql
ALTER TABLE devices ADD COLUMN power_source TEXT NOT NULL DEFAULT 'unknown';
```

Existing rows default to `unknown` and therefore go through the heuristic until
their integration re-declares them at the next discovery, which happens on every
plugin start.

New table:

```sql
CREATE TABLE IF NOT EXISTS battery_alerts (
  device_data_id   TEXT PRIMARY KEY,
  device_id        TEXT NOT NULL,
  device_name      TEXT NOT NULL,
  value            TEXT NOT NULL,
  raised_at        TEXT NOT NULL,
  last_notified_at TEXT NOT NULL
);
```

No foreign key on `device_data(id)`: the sweep already reconciles orphans, and a
cascade delete would drop the row without giving the monitor the chance to emit
`system.alarm.resolved` (the banner would keep a ghost entry until the next UI
reload).

`device_name` is denormalized so a resolve message can still name a device that
has just been deleted. `value` holds the raw low value as text, purely for
diagnostics in the resolve log.

### Types (`src/shared/types.ts`)

```ts
export type PowerSource = "battery" | "mains" | "dc" | "unknown";

export interface BatteryAlert {
  deviceDataId: string;
  deviceId: string;
  deviceName: string;
  value: string;
  raisedAt: string;
  lastNotifiedAt: string;
}
```

`Device` gains `powerSource: PowerSource` (never optional on the read model —
`rowToDevice` defaults to `"unknown"`), and `DiscoveredDevice` in
`device-manager.ts` gains an optional `powerSource?: PowerSource`, persisted by
`upsertFromDiscovery`. A plugin that omits it leaves the column at `unknown`; the
scoped-deps gate (spec 111) is unchanged — the field travels inside the existing
discovery payload.

No new event type: the monitor reuses `system.alarm.raised` / `system.alarm.resolved`.

### Constants (`src/shared/constants.ts`)

```ts
export const LOW_BATTERY_THRESHOLD_PCT = 20;
export const LOW_BATTERY_RECOVERY_PCT = 25; // 5-point hysteresis band
export const BATTERY_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const BATTERY_SWEEP_START_DELAY_MS = 30 * 1000;
export const BATTERY_REMINDER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/** Categories proving a device is mains-fed, used when powerSource is unknown.
 *  `voltage` is absent on purpose: battery sensors report their cell voltage. */
export const MAINS_DATA_CATEGORIES: ReadonlySet<DataCategory> = new Set([
  "power",
  "energy",
  "current",
]);
```

## BatteryMonitor

```ts
class BatteryMonitor {
  constructor(db, eventBus, deviceManager, logger);
  init(): void; // load alerts, subscribe, arm the startup sweep
  destroy(): void; // unsubscribe, clear timer
}
```

State:

- `alerts: Map<deviceDataId, BatteryAlert>` — mirror of the table, authoritative
  in memory, written through on every change.
- `batteryDataIds: Set<string>` — the watched data ids, rebuilt by each sweep.
  The `device.data.updated` handler returns immediately for anything not in the
  set, so the hot path (every device report of every integration) costs one
  `Set.has`.

Two pure exported functions carry the decisions, so the tests exercise them
directly:

```ts
export function isBatteryPowered(device: DeviceWithDetails): boolean;
export function isBatteryData(data: { key: string; category: string }): boolean;
export function classifyBattery(value: unknown): "low" | "ok" | "ignore";
```

`"ignore"` means "hold the current state" — it covers both unreadable values and
the hysteresis band, which is why the classifier needs no knowledge of the alert
state.

`isBatteryPowered` returns on `powerSource` when it is known, and otherwise
`!device.data.some((d) => MAINS_DATA_CATEGORIES.has(d.category))`. A watched data
is one whose `category === "battery"` **or** whose `key === "battery_low"`.

Sweep (`BATTERY_SWEEP_START_DELAY_MS` after `init`, then every
`BATTERY_SWEEP_INTERVAL_MS`):

1. `deviceManager.getAllWithData()` → rebuild `batteryDataIds`, evaluate every
   battery data.
2. For each still-low alert whose `lastNotifiedAt` is older than
   `BATTERY_REMINDER_INTERVAL_MS`, re-emit `system.alarm.raised` and stamp
   `lastNotifiedAt`.
3. For each alert whose data id is no longer present, emit
   `system.alarm.resolved` and delete the row.

The startup delay lets integration plugins connect and publish their first
reports, so the first sweep sees fresh values rather than whatever survived the
restart.

## Notification broadcast fix

`NotificationPublishService.sendSystemAlarm` currently:

```ts
const telegramPub = publishers.find((p) => p.channelType === "telegram" && p.enabled);
if (!telegramPub) return;
```

becomes a loop over every enabled publisher, resolving `this.channels[p.channelType]`,
each `send` catching its own error so one dead channel does not swallow the
others. Same message, same format. This changes behavior for **all** system
alarms (order-unconfirmed included), which is what spec 141 already claimed the
pipeline did.

## API

`GET /api/v1/devices/battery-alerts` (in `src/api/routes/devices.ts` — a static
path, which Fastify's router matches ahead of `/api/v1/devices/:id`) returns the
active alerts:

```json
[
  {
    "deviceDataId": "…",
    "deviceId": "…",
    "deviceName": "Capteur porte garage",
    "value": "12",
    "raisedAt": "2026-08-12T09:00:00.000Z",
    "lastNotifiedAt": "2026-08-12T09:00:00.000Z"
  }
]
```

`registerDeviceRoutes` takes the monitor as a new dependency.

## UI

### Alarm restore

`ui/src/store/useWebSocket.ts` — the reconnect handler already rebuilds the alarm
map from `/api/v1/health` (integration errors). It additionally fetches
`/api/v1/devices/battery-alerts`, keeps the raw list in a new
`batteryAlerts: BatteryAlert[]` slice, and merges an entry per alert into the
alarm map:

```ts
alarms.set(`battery-low:${a.deviceDataId}`, {
  alarmId: `battery-low:${a.deviceDataId}`,
  level: "warning",
  source: a.deviceName,
  message: `Low battery: ${a.value}%`,
});
```

Both fetches resolve into a single `set()` so the second does not clobber the
first. A `system.alarm.raised` / `resolved` whose `alarmId` starts with
`battery-low:` triggers a refetch of that list, which keeps `batteryAlerts`
accurate without adding a device id to the generic alarm event shape.

Everything downstream — header pill, `AlarmsSheet`, acknowledgement — is
unchanged: they consume `useAggregatedIssues`, which reads the alarm map.

`useAggregatedIssues` dedups **by source**: two low batteries on devices with the
same name collapse into one banner line. Accepted (the notifications are still
two), and it is pre-existing behavior for every alarm.

### Equipment indicator

`useEquipmentState(equipment)` already computes `batteryBindings` for every card;
it also returns `batteryAlert: BatteryAlert | null` — the first entry of
`batteryAlerts` whose `deviceId` matches any of the equipment's data bindings.
Matching on the **device**, not on the battery binding, is what lets an equipment
bound only to `temperature` still show the marker.

`SensorValues` takes the new `batteryAlert` prop, and its indicator block moves
above/before the sensor-values block in both layouts (`row` → left of the values,
`column` → first line). Render condition becomes
`minBattery < 30 || batteryAlert !== null`, styling red when `batteryAlert`, and
the percentage is dropped when no numeric level exists (boolean `battery_low`).
The four call sites (`CompactEquipmentCard`, `EquipmentWidget`,
`WidgetDetailSheet`, `EquipmentCard`) pass the prop through from
`useEquipmentState`.

## Files changed

| File                                                     | Change                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| `migrations/017_battery_alerts.sql`                      | `devices.power_source` column + `battery_alerts` table     |
| `src/shared/types.ts`                                    | `PowerSource`, `Device.powerSource`, `BatteryAlert`        |
| `src/shared/constants.ts`                                | thresholds, intervals, `MAINS_DATA_CATEGORIES`             |
| `src/devices/device-manager.ts`                          | discover / persist / read `powerSource`                    |
| `src/devices/battery-monitor.ts`                         | new monitor                                                |
| `src/devices/battery-monitor.test.ts`                    | new tests                                                  |
| `src/notifications/notification-publish-service.ts`      | `sendSystemAlarm` broadcasts to all enabled channels       |
| `src/notifications/notification-publish-service.test.ts` | broadcast tests                                            |
| `src/api/routes/devices.ts`                              | `GET /devices/battery-alerts`                              |
| `src/api/server.ts`                                      | pass the monitor to the device routes                      |
| `src/index.ts`                                           | instantiate + `init()` (skipped in shadow mode)            |
| `ui/src/types.ts`                                        | `BatteryAlert`, `Device.powerSource`                       |
| `ui/src/store/useWebSocket.ts`                           | `batteryAlerts` slice, restore + refetch on battery alarms |
| `ui/src/components/equipments/useEquipmentState.ts`      | expose `batteryAlert` for the equipment                    |
| `ui/src/components/equipments/SensorValues.tsx`          | indicator moved first + alert state                        |
| `ui/src/components/{home,dashboard,equipments}/*`        | pass `batteryAlert` through (4 call sites)                 |
| `docs/technical/data-model.md`                           | `battery_alerts` table, `power_source` column              |
| `docs/technical/api-reference.md`                        | the new route                                              |
| `docs/technical/plugin-development.md` (+ `.fr`)         | `powerSource` in the discovery contract                    |
| `docs/specs-index.md`                                    | spec 143 row                                               |

### Companion PR — `sowel-plugin-zigbee2mqtt` (2.5.0)

| File                | Change                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `src/z2m-parser.ts` | map `z2mDevice.power_source` → `powerSource`; add `battery_low: "battery"` to the category map |
| `package.json`      | 2.4.0 → 2.5.0                                                                                  |

Then the mandated registry step in core (spec 089): release the tarball, run
`node scripts/backfill-registry-sha256.mjs`, PR `plugins/registry.json` as
`chore(registry): bump zigbee2mqtt to 2.5.0`.
