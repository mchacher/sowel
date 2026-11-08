# Modes

> **Orchestration**: cross-cutting state machines that flip the whole house in one gesture. This page also covers their two companion entities -- Button Action Bindings (one-tap triggers) and Calendar (scheduled mode changes).

## Mode

A **Mode** is a named state (e.g. "Day", "Night", "Away", "Vacances") that, when activated, applies a configured set of **impacts** across one or more zones.

### 1 Interfaces

```typescript
interface Mode {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  active: boolean; // Persisted -- restored on engine restart
  createdAt: string;
  updatedAt: string;
}

type ZoneModeImpactAction =
  | { type: "order"; equipmentId: string; orderAlias: string; value: unknown }
  | { type: "recipe_toggle"; instanceId: string; enabled: boolean }
  | { type: "recipe_params"; instanceId: string; params: Record<string, unknown> };

interface ZoneModeImpact {
  id: string;
  modeId: string;
  zoneId: string;
  actions: ZoneModeImpactAction[]; // Stored as JSON in the row
}

interface ModeWithDetails extends Mode {
  impacts: ZoneModeImpact[];
}
```

### 2 Behavior

- Modes are **not exclusive by default** -- multiple modes can be active simultaneously. Mutual exclusion (e.g. Day vs Night) is enforced at the policy level (calendar configuration, button bindings).
- On `activateMode(id)`, the manager iterates all `ZoneModeImpact` rows for the mode and applies each action: dispatching equipment orders, toggling recipe instances, or updating recipe instance params.
- `applyModeToZone(modeId, zoneId)` re-runs the impact for a single zone without changing the active flag (useful for "re-apply current mode" on a specific room).
- Action errors are logged but never abort the rest of the impact set.

### 3 SQLite Schema

```sql
CREATE TABLE modes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE zone_mode_impacts (
  id TEXT PRIMARY KEY,
  mode_id TEXT NOT NULL REFERENCES modes(id) ON DELETE CASCADE,
  zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  actions TEXT NOT NULL              -- JSON: ZoneModeImpactAction[]
);
CREATE UNIQUE INDEX idx_zone_mode_impacts_unique ON zone_mode_impacts(mode_id, zone_id);
```

---

## Button Action Binding

A **ButtonActionBinding** wires a Zigbee button (or any Equipment of type `button` whose data binding alias is `action`) to a high-level effect. When the bound `action` value fires, the engine executes the configured effect.

```typescript
type ButtonEffectType =
  | "mode_activate" // config: { modeId }
  | "mode_toggle" // config: { modeOnId, modeOffId } (mutually exclusive pair)
  | "equipment_order" // config: { equipmentId, orderAlias, value }
  | "recipe_toggle" // config: { instanceId }
  | "zone_order"; // config: { zoneId, orderKey, value? }

interface ButtonActionBinding {
  id: string;
  equipmentId: string; // FK -> Equipment of type "button"
  actionValue: string; // Match against the equipment's action alias value
  effectType: ButtonEffectType;
  config: Record<string, unknown>; // Shape depends on effectType (see above)
  createdAt: string;
}
```

The manager subscribes to `equipment.data.changed` events with `alias === "action"` and dispatches the matching binding.

### SQLite Schema

```sql
CREATE TABLE button_action_bindings (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  action_value TEXT NOT NULL,
  effect_type TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',     -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## Calendar (Mode Scheduling)

Calendars schedule mode activations/deactivations on a recurring weekly basis. Two profiles are seeded at first run: **Travail** and **Vacances** (ids `travail`, `vacances`, `built_in = 1`). Their identity is the id: the UI shows them in the viewer's language (`calendar.builtInProfile.*`) for as long as they keep their seeded name, and shows a name set otherwise as it is. There is no rename API. Only one profile is **active** at a time (key `calendar.activeProfileId` in the `settings` table).

```typescript
interface CalendarProfile {
  id: string;
  name: string;
  builtIn: boolean;
  createdAt: string;
}

interface CalendarModeAction {
  modeId: string;
  action: "on" | "off";
}

interface CalendarSlot {
  id: string;
  profileId: string;
  days: number[]; // 0=Sunday..6=Saturday
  time: string; // "HH:MM" (local time)
  modeActions: CalendarModeAction[]; // Multiple modes can be flipped at the same slot
}
```

`CalendarManager` uses `croner` to schedule every slot of the active profile. On profile change, all crons are torn down and rebuilt. Slot firing calls `ModeManager.activateMode` / `deactivateMode` and emits `calendar.profile.changed` when the active profile itself is changed.

### SQLite Schema

```sql
CREATE TABLE calendar_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  built_in INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Seeded:
--   ('travail', 'Travail', 1)
--   ('vacances', 'Vacances', 1)

CREATE TABLE calendar_slots (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES calendar_profiles(id) ON DELETE CASCADE,
  days TEXT NOT NULL,           -- JSON: number[]
  time TEXT NOT NULL,           -- "HH:MM"
  mode_ids TEXT NOT NULL,       -- legacy column, kept for back-compat (JSON)
  mode_actions TEXT             -- JSON: CalendarModeAction[]
);
```

<!-- MISMATCH: the legacy `mode_ids` column is still required by the schema (NOT NULL) but is not part of the runtime CalendarSlot interface; new code reads `mode_actions` only. Inserts must keep filling `mode_ids` with a JSON array (commonly the modeIds extracted from modeActions) until a future migration drops it. -->

---
