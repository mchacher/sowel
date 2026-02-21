# Architecture: V0.9 Modes

## Data Model

### New Types (`src/shared/types.ts`)

```typescript
// ============================================================
// Mode
// ============================================================

export interface Mode {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModeEventTrigger {
  id: string;
  modeId: string;
  equipmentId: string;
  alias: string;         // data alias to watch (e.g. "action")
  value: unknown;        // value to match (e.g. "single", true)
}

export type ZoneModeImpactAction =
  | {
      type: "order";
      equipmentId: string;
      orderAlias: string;
      value: unknown;
    }
  | {
      type: "recipe_toggle";
      instanceId: string;
      enabled: boolean;
    }
  | {
      type: "recipe_params";
      instanceId: string;
      params: Record<string, unknown>;
    };

export interface ZoneModeImpact {
  id: string;
  modeId: string;
  zoneId: string;
  actions: ZoneModeImpactAction[];
}

export interface ModeWithDetails extends Mode {
  eventTriggers: ModeEventTrigger[];
  impacts: ZoneModeImpact[];
}

// ============================================================
// Calendar
// ============================================================

export interface CalendarProfile {
  id: string;
  name: string;            // "Travail", "Vacances"
  builtIn: boolean;        // true for default profiles
  createdAt: string;
}

export interface CalendarSlot {
  id: string;
  profileId: string;
  days: number[];          // 0=Sun, 1=Mon, ..., 6=Sat (array for multi-day)
  time: string;            // "HH:MM" format (e.g. "08:00")
  modeIds: string[];       // modes to activate at this time
}
```

### New Event Bus Events

```typescript
// Mode events (add to EngineEvent union)
| { type: "mode.created"; mode: Mode }
| { type: "mode.updated"; mode: Mode }
| { type: "mode.removed"; modeId: string; modeName: string }
| { type: "mode.activated"; modeId: string; modeName: string }
| { type: "mode.deactivated"; modeId: string; modeName: string }
| { type: "calendar.profile.changed"; profileId: string; profileName: string }
```

### SQLite Schema (new migration)

```sql
-- migration: 005-modes.sql

-- Modes
CREATE TABLE IF NOT EXISTS modes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Event triggers (button press, data change)
CREATE TABLE IF NOT EXISTS mode_event_triggers (
  id TEXT PRIMARY KEY,
  mode_id TEXT NOT NULL REFERENCES modes(id) ON DELETE CASCADE,
  equipment_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  value TEXT NOT NULL  -- JSON serialized
);

-- Zone impacts (what a mode does in each zone)
CREATE TABLE IF NOT EXISTS zone_mode_impacts (
  id TEXT PRIMARY KEY,
  mode_id TEXT NOT NULL REFERENCES modes(id) ON DELETE CASCADE,
  zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  actions TEXT NOT NULL  -- JSON array of ZoneModeImpactAction
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zone_mode_impacts_unique
  ON zone_mode_impacts(mode_id, zone_id);

-- Calendar profiles (Travail, Vacances)
CREATE TABLE IF NOT EXISTS calendar_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  built_in INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Calendar time slots
CREATE TABLE IF NOT EXISTS calendar_slots (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES calendar_profiles(id) ON DELETE CASCADE,
  days TEXT NOT NULL,       -- JSON array of day numbers [1,2,3,4,5]
  time TEXT NOT NULL,       -- "HH:MM"
  mode_ids TEXT NOT NULL    -- JSON array of mode IDs
);

-- Active profile (stored in settings table, key: "calendar.activeProfileId")

-- Seed default profiles
INSERT OR IGNORE INTO calendar_profiles (id, name, built_in)
  VALUES ('travail', 'Travail', 1);
INSERT OR IGNORE INTO calendar_profiles (id, name, built_in)
  VALUES ('vacances', 'Vacances', 1);
```

## Component Architecture

### ModeManager (`src/modes/mode-manager.ts`)

Responsibilities:
- CRUD for modes, event triggers, and zone impacts
- Activate / deactivate mode logic
- Execute zone impacts on activation (snapshot)
- Listen to event bus for event triggers

```
ModeManager
├── createMode(name, icon?, description?) → Mode
├── updateMode(id, updates) → Mode
├── deleteMode(id) → void
├── getMode(id) → ModeWithDetails
├── listModes() → ModeWithDetails[]
├── activateMode(id) → void       // execute impacts
├── deactivateMode(id) → void     // just flip active flag
├── addEventTrigger(modeId, config) → ModeEventTrigger
├── removeEventTrigger(triggerId) → void
├── setZoneImpact(modeId, zoneId, actions) → ZoneModeImpact
├── removeZoneImpact(impactId) → void
└── init() → void                 // register event listeners
```

### CalendarManager (`src/modes/calendar-manager.ts`)

Responsibilities:
- CRUD for calendar profiles and time slots
- Manage the active profile
- Schedule/unschedule cron jobs based on active profile slots
- On cron fire: call ModeManager.activateMode() for each mode in the slot

```
CalendarManager
├── listProfiles() → CalendarProfile[]
├── getActiveProfile() → CalendarProfile
├── setActiveProfile(profileId) → void    // reschedule all cron jobs
├── listSlots(profileId) → CalendarSlot[]
├── addSlot(profileId, days, time, modeIds) → CalendarSlot
├── updateSlot(slotId, updates) → CalendarSlot
├── removeSlot(slotId) → void
└── init() → void                         // load active profile, schedule cron jobs
```

### Activation Flow

```
1. Calendar cron fires at 08:00
   → CalendarManager reads slot: modeIds = ["confort-chauffage", "eclairage-jour"]
   → For each modeId:
     → ModeManager.activateMode(modeId)
       → Set mode.active = true in DB
       → Load zone_mode_impacts for this mode
       → For each impact:
         → type "order": EquipmentManager.executeOrder(equipmentId, alias, value)
         → type "recipe_toggle": RecipeManager.setEnabled(instanceId, enabled)
         → type "recipe_params": RecipeManager.updateParams(instanceId, params)
       → Emit "mode.activated" event
       → WebSocket broadcasts to clients

2. Button press detected
   → EventBus: "equipment.data.changed" (equipmentId, alias="action", value="single")
   → ModeManager event listener checks all mode_event_triggers
   → Match found for mode "Cocoon"
   → ModeManager.activateMode("cocoon-id")
   → (same flow as above)

3. User clicks "Activate" in UI
   → API: POST /modes/:id/activate
   → ModeManager.activateMode(id)
   → (same flow as above)
```

### Cron Scheduler

Use `croner` (lightweight, ESM-compatible):
- CalendarManager.init(): load active profile → schedule cron for each slot
- On profile switch: unschedule all → schedule new profile's slots
- On slot add/update/remove: reschedule affected cron jobs
- Cron expression built from slot: days + time → e.g. "0 8 * * 1,2,3,4,5"

### Event Trigger Listener

- ModeManager subscribes to `equipment.data.changed` events on init
- For each event: check all mode_event_triggers for match (equipmentId + alias + value)
- If match: activateMode(modeId)

## API Endpoints

### Modes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/modes` | List all modes with triggers and impacts |
| `GET` | `/api/v1/modes/:id` | Get mode with details |
| `POST` | `/api/v1/modes` | Create mode |
| `PUT` | `/api/v1/modes/:id` | Update mode (name, icon, description) |
| `DELETE` | `/api/v1/modes/:id` | Delete mode (cascade triggers + impacts) |
| `POST` | `/api/v1/modes/:id/activate` | Activate mode (execute impacts) |
| `POST` | `/api/v1/modes/:id/deactivate` | Deactivate mode |

### Mode Event Triggers

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/modes/:id/triggers` | Add event trigger to mode |
| `DELETE` | `/api/v1/modes/:id/triggers/:triggerId` | Remove event trigger |

### Zone Mode Impacts

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/zones/:zoneId/mode-impacts` | List impacts for a zone |
| `PUT` | `/api/v1/modes/:id/impacts/:zoneId` | Set impact for mode+zone |
| `DELETE` | `/api/v1/modes/:id/impacts/:zoneId` | Remove impact for mode+zone |

### Calendar

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/calendar/profiles` | List all profiles |
| `GET` | `/api/v1/calendar/active` | Get active profile with slots |
| `PUT` | `/api/v1/calendar/active` | Set active profile |
| `GET` | `/api/v1/calendar/profiles/:id/slots` | List slots for a profile |
| `POST` | `/api/v1/calendar/profiles/:id/slots` | Add slot |
| `PUT` | `/api/v1/calendar/slots/:slotId` | Update slot |
| `DELETE` | `/api/v1/calendar/slots/:slotId` | Delete slot |

## UI Changes

### Settings: Mode Management Page

- List all modes with active/inactive status
- Create/edit mode form (name, icon, description)
- Event trigger editor: select equipment + alias + value
- Per-zone impact editor: select zone → configure orders, recipe toggles, param overrides

### Calendar Page (or Settings sub-page)

- Visual weekly timeline (7 days × 24h grid)
- Profile selector (Travail / Vacances tabs)
- Drag & drop time slots on the timeline
- Each slot shows the mode(s) it activates
- Color-coded by mode

### Zone HomePage > Behaviors Section

- New ID card "MODES" alongside "RECIPES"
- Shows modes that have impacts on this zone
- Toggle active/inactive from the card
- Quick view of what happens when each mode activates

### Zone Status Bar

- Active modes shown as pills/badges in the zone status bar

## File Changes

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add Mode, ModeEventTrigger, ZoneModeImpact, Calendar types + events |
| `migrations/005-modes.sql` | New tables: modes, mode_event_triggers, zone_mode_impacts, calendar_profiles, calendar_slots |
| `src/core/database.ts` | Register new migration |
| `src/modes/mode-manager.ts` | **New** — Mode CRUD + activation + event trigger listener |
| `src/modes/calendar-manager.ts` | **New** — Calendar profile/slot CRUD + cron scheduling |
| `src/api/routes/modes.ts` | **New** — REST API routes for modes |
| `src/api/routes/calendar.ts` | **New** — REST API routes for calendar |
| `src/api/server.ts` | Register mode + calendar routes |
| `src/api/websocket.ts` | Broadcast mode + calendar events |
| `src/index.ts` | Initialize ModeManager + CalendarManager |
| `ui/src/store/useModes.ts` | **New** — Zustand store for modes |
| `ui/src/store/useCalendar.ts` | **New** — Zustand store for calendar |
| `ui/src/components/home/ZoneModesCard.tsx` | **New** — Modes ID card for Behaviors section |
| `ui/src/components/calendar/WeeklyCalendar.tsx` | **New** — Visual weekly timeline |
| `ui/src/pages/ModesPage.tsx` | **New** — Mode management page |

## Dependencies

- Requires V0.8 Recipes (mode impacts toggle/override recipe instances)
- Requires `croner` npm package (lightweight cron scheduler, ESM-compatible)
