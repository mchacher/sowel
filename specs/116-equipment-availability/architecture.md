# Architecture — Equipment availability propagation

## Overview

`Equipment.status` is a **derived** value, computed at read time inside `EquipmentManager`. There is no DB column, no migration, no event-driven cache invalidation. The composition happens whenever the equipment is read via `getByIdWithDetails` / `getAllWithDetails` — the same hooks that already merge `dataBindings`, `orderBindings`, and `computedData`.

A small helper module — `src/equipments/equipment-status.ts` — owns the derivation logic. A separate `src/equipments/equipment-status-tracker.ts` subscribes to `device.status_changed` + `device.data.updated` events and emits `equipment.status.changed` when an equipment crosses a status boundary, so the UI can update reactively without polling.

```
                                       reads device.status + binding.lastUpdated
                                       ┌──────────────────────────────────────┐
                                       ▼                                      │
                       ┌─────────────────────────────┐                       │
device.status_changed  │   equipment-status.ts        │                       │
device.data.updated  ──┤   derive(equipment,          │      one source       │
                       │           bindings, devices) │ ◄─── of truth         │
                       └──────────────┬──────────────┘                       │
                                      │                                      │
                       ┌──────────────▼──────────────┐                       │
                       │  EquipmentManager            │                       │
                       │  .getByIdWithDetails()       │ ───► includes        │
                       │  .getAllWithDetails()        │      status field    │
                       └──────────────┬──────────────┘                       │
                                      │                                      │
                       ┌──────────────▼──────────────┐                       │
                       │  EquipmentStatusTracker      │  emits equipment.    │
                       │  - listens to device events  │  status.changed      │
                       │  - debounce 200 ms           │  on transitions     │
                       │  - maintains a Map<id,status>│                      │
                       └──────────────┬──────────────┘                       │
                                      │                                      │
                       ┌──────────────▼──────────────┐                       │
                       │  EventBus                    │ ────► WebSocket ─────┘
                       │  equipment.status.changed    │       UI Zustand store
                       └──────────────────────────────┘       refreshes
```

## Type changes (`src/shared/types.ts`)

```ts
// === New ===

export type EquipmentStatus = "online" | "degraded" | "offline";

export interface EquipmentStatusReason {
  /** Names of bound devices whose status is "offline". */
  offlineDevices: string[];
  /** Aliases of streaming bindings whose lastUpdated exceeds the timeout. */
  staleBindings: string[];
  /** Earliest lastSeen (devices) / lastUpdated (bindings) among the issues. */
  offlineSince: string | null;
}

// === Modified ===

export interface DataBindingWithValue extends DataBinding {
  // ... existing fields ...
  /** True iff the category is streaming AND lastUpdated exceeds the timeout.
   *  Always false for event-based categories. */
  stale: boolean;
}

export interface EquipmentWithDetails extends Equipment {
  // ... existing fields ...
  status: EquipmentStatus;
  /** Present when status !== "online". */
  statusReason?: EquipmentStatusReason;
}

// === ZoneAggregatedData ===

export interface ZoneAggregatedData {
  // ... existing fields ...
  /** Per-data-category count of equipments that were skipped because they were
   *  offline. Keys are DataCategory strings; missing keys mean zero. */
  unavailableEquipmentsByCategory: Partial<Record<DataCategory, number>>;
}

// === EngineEvent union — new variant ===

export type EngineEvent =
  | /* ...existing... */
  | {
      type: "equipment.status.changed";
      equipmentId: string;
      oldStatus: EquipmentStatus;
      newStatus: EquipmentStatus;
    };
```

## Constants (`src/shared/constants.ts`)

```ts
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

export const STREAMING_TIMEOUT_MS: Partial<Record<DataCategory, number>> = {
  power: 2 * 60 * 1000,
  energy: 10 * 60 * 1000,
  voltage: 5 * 60 * 1000,
  current: 5 * 60 * 1000,
  temperature: 15 * 60 * 1000,
  temperature_outdoor: 15 * 60 * 1000,
  humidity: 15 * 60 * 1000,
  humidity_outdoor: 15 * 60 * 1000,
  pressure: 30 * 60 * 1000,
  luminosity: 15 * 60 * 1000,
  co2: 15 * 60 * 1000,
  voc: 15 * 60 * 1000,
  noise: 15 * 60 * 1000,
  battery: 2 * 60 * 60 * 1000,
  setpoint: 60 * 60 * 1000,
  pool_water_temperature: 15 * 60 * 1000,
  pool_temperature_setpoint: 60 * 60 * 1000,
};

export const DEFAULT_STREAMING_TIMEOUT_MS = 15 * 60 * 1000;
```

## New module: `src/equipments/equipment-status.ts`

Pure functions, no I/O, fully unit-testable.

```ts
import {
  STREAMING_CATEGORIES,
  STREAMING_TIMEOUT_MS,
  DEFAULT_STREAMING_TIMEOUT_MS,
} from "../shared/constants.js";
import type {
  DataBindingWithValue,
  DataCategory,
  Device,
  EquipmentStatus,
  EquipmentStatusReason,
} from "../shared/types.js";

/** Returns true iff the binding is on a streaming category AND its
 *  lastUpdated is older than the per-category threshold. Bindings that
 *  have never been updated (lastUpdated === null) are NOT stale. */
export function isStaleBinding(
  category: DataCategory,
  lastUpdated: string | null,
  now: number = Date.now(),
): boolean {
  if (!STREAMING_CATEGORIES.has(category)) return false;
  if (!lastUpdated) return false;
  const timeoutMs = STREAMING_TIMEOUT_MS[category] ?? DEFAULT_STREAMING_TIMEOUT_MS;
  const updatedMs = new Date(lastUpdated.replace(" ", "T").replace("Z", "+00:00")).getTime();
  return now - updatedMs > timeoutMs;
}

/** Derive the equipment status from its bindings and the devices behind them.
 *  Returns the status + a reason object that the UI uses for tooltips. */
export function deriveEquipmentStatus(
  bindings: DataBindingWithValue[],
  devicesByBindingId: Map<string, Device>,
  now: number = Date.now(),
): { status: EquipmentStatus; reason: EquipmentStatusReason | null } {
  if (bindings.length === 0) {
    return {
      status: "offline",
      reason: { offlineDevices: [], staleBindings: [], offlineSince: null },
    };
  }

  const uniqueDevices = new Map<string, Device>();
  for (const b of bindings) {
    const dev = devicesByBindingId.get(b.id);
    if (dev) uniqueDevices.set(dev.id, dev);
  }

  const offlineDevices = [...uniqueDevices.values()].filter((d) => d.status === "offline");
  const staleBindings = bindings.filter((b) => isStaleBinding(b.category, b.lastUpdated, now));

  const allOffline = uniqueDevices.size > 0 && offlineDevices.length === uniqueDevices.size;
  if (allOffline) {
    return {
      status: "offline",
      reason: {
        offlineDevices: offlineDevices.map((d) => d.name),
        staleBindings: staleBindings.map((b) => b.alias),
        offlineSince: earliestTimestamp([
          ...offlineDevices.map((d) => d.lastSeen),
          ...staleBindings.map((b) => b.lastUpdated),
        ]),
      },
    };
  }

  if (offlineDevices.length > 0 || staleBindings.length > 0) {
    return {
      status: "degraded",
      reason: {
        offlineDevices: offlineDevices.map((d) => d.name),
        staleBindings: staleBindings.map((b) => b.alias),
        offlineSince: earliestTimestamp([
          ...offlineDevices.map((d) => d.lastSeen),
          ...staleBindings.map((b) => b.lastUpdated),
        ]),
      },
    };
  }

  return { status: "online", reason: null };
}

function earliestTimestamp(values: (string | null)[]): string | null {
  const valid = values.filter((v): v is string => v !== null);
  if (valid.length === 0) return null;
  return valid.reduce((min, v) => (v < min ? v : min));
}
```

## EquipmentManager changes (`src/equipments/equipment-manager.ts`)

Two hooks to extend: `getByIdWithDetails` and `getAllWithDetails`.

```ts
import { deriveEquipmentStatus, isStaleBinding } from "./equipment-status.js";

// In getDataBindingsWithValues — annotate each binding with .stale:
private getDataBindingsWithValues(equipmentId: string): DataBindingWithValue[] {
  const rows = this.stmts.getDataBindings.all(equipmentId) as DataBindingRow[];
  return rows.map((row) => {
    const binding = rowToBindingWithValue(row);
    return {
      ...binding,
      stale: isStaleBinding(binding.category, binding.lastUpdated),
    };
  });
}

// In getByIdWithDetails — add status:
getByIdWithDetails(id: string): EquipmentWithDetails | null {
  const equipment = this.getById(id);
  if (!equipment) return null;

  const dataBindings = this.getDataBindingsWithValues(id);
  const orderBindings = this.getOrderBindingsWithDetails(id);
  const computedData = this.getComputedData(id);

  const devicesByBindingId = this.resolveDevicesForBindings(dataBindings, orderBindings);
  const { status, reason } = deriveEquipmentStatus(dataBindings, devicesByBindingId);

  return {
    ...equipment,
    dataBindings,
    orderBindings,
    status,
    ...(reason !== null ? { statusReason: reason } : {}),
    ...(computedData.length > 0 ? { computedData } : {}),
  };
}

// resolveDevicesForBindings: small helper that maps each binding to its Device
// using deviceManager.getById, returning a Map<bindingId, Device>. Cache the
// per-call device lookups to avoid N+1.
```

`getAllWithDetails` follows the same pattern, with a single batch device fetch up front to avoid repeated DB hits when the equipment list is long.

## New module: `src/equipments/equipment-status-tracker.ts`

```ts
import type { Logger } from "../core/logger.js";
import type { EventBus } from "../core/event-bus.js";
import type { EquipmentManager } from "./equipment-manager.js";
import type { EquipmentStatus } from "../shared/types.js";

const DEBOUNCE_MS = 200;

export class EquipmentStatusTracker {
  private currentStatus = new Map<string, EquipmentStatus>();
  private pending: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private equipmentManager: EquipmentManager,
    private eventBus: EventBus,
    private logger: Logger,
  ) {
    this.logger = logger.child({ module: "equipment-status-tracker" });
  }

  start(): void {
    // Initial snapshot
    for (const eq of this.equipmentManager.getAllWithDetails()) {
      this.currentStatus.set(eq.id, eq.status);
    }

    this.eventBus.on((event) => {
      if (
        event.type === "device.status_changed" ||
        event.type === "device.data.updated" ||
        event.type === "equipment.bindings.changed"
      ) {
        this.scheduleRecompute();
      }
    });

    // Periodic recompute every 60 s for streaming staleness (no event-driven trigger
    // when nothing arrives — we need a wallclock tick).
    setInterval(() => this.recompute(), 60_000).unref();
  }

  private scheduleRecompute(): void {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      this.recompute();
    }, DEBOUNCE_MS);
  }

  private recompute(): void {
    for (const eq of this.equipmentManager.getAllWithDetails()) {
      const previous = this.currentStatus.get(eq.id);
      if (previous !== eq.status) {
        this.currentStatus.set(eq.id, eq.status);
        this.eventBus.emit({
          type: "equipment.status.changed",
          equipmentId: eq.id,
          oldStatus: previous ?? "online",
          newStatus: eq.status,
        });
        this.logger.info(
          { equipmentId: eq.id, name: eq.name, oldStatus: previous, newStatus: eq.status },
          "Equipment status changed",
        );
      }
    }
  }
}
```

Wired in `src/index.ts` after `EquipmentManager` is created and started, alongside other trackers.

## EnergyAggregator changes (`src/energy/energy-aggregator.ts`)

The live-power read happens in `getComputedDataForEquipment` (today returns the computed cumuls). Live power is currently read directly from the binding by the LiveEnergyPage (`sumPower` on `equipment.dataBindings` filtered by alias). We make that helper stale-aware on the **frontend** side; on the backend, we only need to ensure `equipment.dataBindings[].stale` is correctly set (already done via the `EquipmentManager` change above).

For the InfluxDB-driven cumuls (hour/day/month/year): no change. Those are historical aggregates of points actually written to InfluxDB; they're inherently "what happened in the past" and not affected by current liveness.

If the live power chart in the UI uses an `/api/v1/energy/live` endpoint (TBD — verify during implementation), that endpoint should also return `{ stale: true, lastUpdated }` per equipment when the binding is stale, mirroring the binding-level flag. If the chart reads directly from `equipment.dataBindings`, no backend change is needed beyond the `stale` flag.

## ZoneAggregator changes (`src/zones/zone-aggregator.ts`)

```ts
// In the per-equipment loop:
for (const equipment of equipments) {
  // Existing code reads bindings + accumulates.
  if (equipment.status === "offline") {
    for (const binding of equipment.dataBindings) {
      const cat = binding.category;
      result.unavailableEquipmentsByCategory[cat] =
        (result.unavailableEquipmentsByCategory[cat] ?? 0) + 1;
    }
    continue; // do not contribute to averages/sums
  }
  // Degraded equipments contribute with last known values — no change.
  // ... existing accumulator logic ...
}
```

The aggregator already calls `getAllWithDetails` (or equivalent) so the `status` field is available without extra fetches.

## API surface

- `GET /api/v1/equipments` — payload gains `status` + optional `statusReason` on each equipment. No breaking change (additive fields).
- `GET /api/v1/equipments/:id` — same.
- `GET /api/v1/zones/:id/aggregated` — payload gains `unavailableEquipmentsByCategory`. No breaking change.
- WebSocket — new event type `equipment.status.changed` broadcast to authenticated clients.

## Frontend changes (`ui/src/`)

### Stores

`stores/equipments.ts` (Zustand): on receiving `equipment.status.changed`, update the equipment's `status` field in-place. Triggers a re-render of any subscribed component.

### Components

| Component                                | Change                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `EquipmentStatusBadge.tsx` (NEW)         | Renders ambre/red badge for `degraded`/`offline`; nothing for `online`. With Lucide icon + tooltip via `<Tooltip>`.    |
| `CompactEquipmentCard.tsx`               | Render badge top-right.                                                                                                |
| `EquipmentDetailCard.tsx`                | Render badge next to name in header.                                                                                   |
| `LiveEnergyPage.tsx`                     | In `sumPower`, also collect each binding's `stale` flag; if any contributing binding is stale, render the warning HUD. |
| `EnergyDataPanel.tsx`                    | If `equipment.status !== "online"`, show "Last update X ago" subtitle.                                                 |
| `ZoneWidget.tsx` / `CompactZoneCard.tsx` | Append "(X unavailable)" hint when `unavailableEquipmentsByCategory[<cat>] > 0`.                                       |
| Dashboard family widgets                 | Append warning badge to header when any equipment in family is offline.                                                |

### i18n

New keys in `ui/src/i18n/locales/{en,fr}.json` (full list in spec.md FR12).

## Database

No migration. `Equipment.status` is derived. No new tables, no new columns.

## Observability

- Pino structured log on every status transition (in `EquipmentStatusTracker.recompute`).
- Log level `info` for `online → degraded`, `info` for `degraded → offline`, `info` for any → `online`. Not `warn` — going offline can be intentional (user shut something off at the breaker).
- No metrics endpoint changes.

## Performance considerations

- `EquipmentStatusTracker` periodic recompute runs every 60 s. With ~100 equipments × ~3 bindings each, the derivation cost is sub-millisecond. Negligible.
- Debouncing event-driven recomputes by 200 ms avoids storm-recomputing during integration startup (when many `device.status_changed` events fire in a burst).
- `getAllWithDetails` already iterates equipments; the new status derivation adds a Map lookup per binding (O(1)). No new DB hits beyond a single device fetch per binding (already cached in-Map per call).

## Migration / rollout

- No DB migration.
- No backwards-incompatible API change (additive fields only).
- Plugins that don't call `updateDeviceStatus` correctly will see their equipments stay `online` indefinitely — this is the existing behavior; the spec just exposes it. The plugin contract section in `plugin-development.md` documents known offenders and the path to fix them in their respective repos.
- No feature flag. Ship directly; the behavior is purely additive.
