# V0.9: Modes (Operating Modes)

## Summary

Introduce **Modes** — named operating profiles defined at the house level that alter the behavior of zones when activated. A Mode is a global entity; its concrete impact is configured per-zone inside the zone's Behaviors section. When a Mode activates, each zone that has an impact defined for that mode executes its actions once (snapshot): equipment orders, recipe enable/disable, and recipe parameter overrides.

Modes are a **distinct concept from Recipes**:
- **Recipe** = reactive automation (event-driven state machine running continuously)
- **Mode** = operating profile (global state that configures how a zone behaves)

## Reference

- Spec sections: §5 (Scenario/Recipe), §4 (Zone)
- Roadmap: V0.9 (after V0.8 Recipes)

## Key Concepts

### Mode (global, house-level)

A Mode is a named operating profile for the entire house:
- Defined once at the house level (not per zone)
- Can be activated/deactivated manually (UI, API) or automatically (calendar, event trigger)
- Multiple modes can be active simultaneously (user's responsibility for conflicts)
- Activating a mode does NOT automatically deactivate other modes
- A mode may have NO automatic trigger at all (purely manual activation)

### Mode Activation (3 ways)

| Method | Description |
|--------|-------------|
| **Calendar** | Weekly schedule activates mode(s) at specified times |
| **Event trigger** | Equipment data change (e.g. button press) activates mode |
| **Manual** | User activates via UI or API |

A mode can use any combination: calendar + event trigger, event only, manual only, etc.
A calendar time slot can activate **multiple modes** simultaneously.

### Weekly Calendar

The calendar is a **visual weekly schedule** that orchestrates mode activations:
- **Week profiles**: "Travail" and "Vacances" by default (extensible later)
- **Active profile**: selected manually by the user
- **Time slots**: each slot specifies a day (or day range), time, and one or more modes to activate
- Multiple modes can fire at the same time slot
- Not all modes need to be in the calendar (some are trigger-only or manual-only)

Example:
```
Profile "Travail":
  Lun-Ven 07:00 → "Confort Chauffage" + "Éclairage Jour"
  Lun-Ven 09:00 → "Confort Auto"
  Lun-Ven 23:00 → "Nuit"
  Sam-Dim 09:00 → "Confort Chauffage"
  Sam-Dim 23:30 → "Nuit"

Profile "Vacances":
  Tous les jours 09:00 → "Confort Chauffage"
  Tous les jours 10:00 → "Confort Auto"
  Tous les jours 23:30 → "Nuit"
```

### Event Triggers

Some modes are activated by equipment events (overriding the calendar):
- A button press can activate "Cocoon" at any time
- An equipment data change can activate a mode (e.g. window opened → "Ventilation")
- Event triggers are defined per mode (optional — a mode can have zero event triggers)

### Zone Mode Impact (per zone, in Behaviors)

Each zone independently configures what happens when a given mode activates:
- **Equipment orders**: execute orders on zone equipments (snapshot, once)
- **Recipe toggles**: enable or disable specific recipe instances in the zone
- **Recipe parameter overrides**: modify parameters of active recipe instances
- A zone with no impact defined for a mode is unaffected

### Examples

**Mode "Confort Chauffage"** (calendar: Lun-Ven 07:00)
- Salon: heating setpoint → 21°C, presence detection recipe → disabled
- Chambre: heating setpoint → 20°C

**Mode "Éclairage Jour"** (calendar: Lun-Ven 07:00, same slot as above)
- Salon: ceiling light recipe → enabled
- Bureau: desk lamp → ON

**Mode "Confort Auto"** (calendar: Lun-Ven 09:00)
- Salon: presence detection recipe → enabled (manages eco/comfort automatically)

**Mode "Cocoon"** (event trigger: button press, no calendar)
- Salon: pellet stove → 23°C, wall lights → 10%, motion-light recipe → disabled
- Chambre: shutters → closed, night light → ON

## Acceptance Criteria

### Mode Management

- [ ] CRUD for modes (create, read, update, delete) via API
- [ ] Mode has: id, name, icon, description, active status
- [ ] Activate/deactivate mode via API (`POST /modes/:id/activate`, `POST /modes/:id/deactivate`)
- [ ] Mode activation executes all zone impacts as a snapshot (once)
- [ ] Mode deactivation does NOT rollback — it only changes the mode's active flag
- [ ] Multiple modes can be active at the same time
- [ ] Mode state persisted in SQLite (survives restart)

### Event Triggers

- [ ] CRUD for event triggers on a mode (optional, zero or more per mode)
- [ ] Trigger matches on: equipmentId + data alias + value
- [ ] Event listener activates mode when equipment data matches trigger config
- [ ] Event triggers re-registered on engine restart

### Weekly Calendar

- [ ] Two default week profiles: "Travail" and "Vacances"
- [ ] Active profile selected manually (persisted in settings)
- [ ] Time slots: day(s) + time + list of mode IDs to activate
- [ ] Multiple modes can share the same time slot
- [ ] Calendar scheduler fires at specified times and activates listed modes
- [ ] Scheduler re-registered on engine restart and on profile switch
- [ ] Visual calendar UI (timeline view, 7 days × 24h)

### Zone Mode Impact

- [ ] CRUD for zone mode impacts via API
- [ ] Impact types: equipment orders, recipe enable/disable, recipe parameter overrides
- [ ] When mode activates, each zone's impact executes independently
- [ ] Zones without impacts for a mode are unaffected
- [ ] Equipment orders executed via existing order dispatch pipeline (MQTT publish)
- [ ] Recipe toggles use RecipeManager.enable() / .disable()
- [ ] Recipe parameter overrides update instance params and restart if running

### Event Bus

- [ ] `mode.activated` event emitted when a mode is activated
- [ ] `mode.deactivated` event emitted when a mode is deactivated
- [ ] `mode.created`, `mode.updated`, `mode.removed` events for CRUD
- [ ] `calendar.profile.changed` event when active profile switches

### WebSocket

- [ ] All mode events broadcast to connected UI clients
- [ ] Clients receive current active modes on connection

### UI (Behaviors section)

- [ ] Mode management page (Settings or dedicated page): list modes, create/edit/delete
- [ ] Zone Behaviors section: show active modes as ID cards alongside Recipes
- [ ] Zone mode impact editor: configure orders, recipe toggles, parameter overrides per mode per zone
- [ ] Quick-activate/deactivate mode from UI (zone header or behaviors section)
- [ ] Active mode indicator in zone status bar
- [ ] Weekly calendar visual editor (timeline per week profile)
- [ ] Week profile selector (Travail / Vacances)

## Scope

### In Scope

- Mode entity (global): CRUD, activation/deactivation
- Event triggers on modes (optional, per mode)
- Weekly calendar with two profiles (Travail, Vacances)
- Zone mode impact: CRUD, execution on mode activation
- Impact types: equipment orders, recipe enable/disable, recipe parameter overrides
- SQLite persistence (modes, mode_event_triggers, calendar_profiles, calendar_slots, zone_mode_impacts)
- REST API endpoints
- Event bus events + WebSocket broadcast
- UI: mode management + calendar editor + zone impact configuration + active mode display

### Out of Scope

- Custom week profiles beyond Travail/Vacances (deferred)
- Date-based profile switching (e.g. "Feb 15-28 = Vacances") (deferred)
- External calendar integration (Google Calendar, iCal) (deferred)
- Mode groups / mutual exclusion (user manages conflicts manually)
- Rollback on deactivation (no state restoration)
- Mode inheritance (child zones don't inherit parent impacts)
- Mode priority / conflict resolution engine
- Mode history / audit log (deferred)

## Edge Cases

- Mode activated with no zone impacts defined → mode becomes active, nothing executes (log info)
- Zone impact references a deleted equipment → skip that order, log warning
- Zone impact references a deleted recipe instance → skip that toggle, log warning
- Calendar slot fires → activates all listed modes (each independently)
- Calendar slot references a deleted mode → skip, log warning
- Profile switched → unregister old profile's cron jobs, register new profile's cron jobs
- Engine restart → restore active profile, register cron jobs, register event listeners
- Recipe parameter override with invalid value → skip override, log error
- Multiple modes modify the same equipment → both execute in order (last write wins, user's responsibility)
- Mode activated while already active → no-op (log info)
- Mode deactivated while already inactive → no-op (log info)
- Mode with no triggers (no calendar, no event) → only activatable manually (UI/API)
