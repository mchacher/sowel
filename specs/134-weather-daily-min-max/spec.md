# Spec 134 — Daily min/max temperature on weather equipments

## Context

Spec 114 (Weather station UX) reworked the weather widgets but explicitly
deferred daily min/max temperature ("would require additional history
queries — kept for a later spec"). This is that spec.

The user wants to see today's measured minimum and maximum temperature on
the dashboard widgets and on the equipment detail panel of a weather
station equipment.

Design decision (user): this is a **core feature**, not a plugin one. A
weather equipment is vendor-agnostic — the Netatmo API happens to provide
`min_temp`/`max_temp`, but other stations (Ecowitt, WeatherFlow, DIY MQTT
sensors) do not. Sowel therefore tracks the extremes itself from the
temperature samples it already receives, following the existing
computed-data tracker pattern (`PoolWaterTempTracker`, spec 121).

## Goal

Track, per `weather` equipment and per temperature binding, the minimum
and maximum value observed since local midnight, and expose them as
computed data entries so the existing UI data flow (REST + WebSocket)
carries them to the dashboard and detail views with no new endpoint.

## Scope

### In scope

- New core tracker `WeatherTempExtremesTracker` in `src/equipments/`:
  listens to `equipment.data.changed`, tracks min/max since local
  midnight for every binding of category `temperature` or
  `temperature_outdoor` on equipments of type `weather` (covers indoor
  and outdoor modules).
- SQLite persistence so a restart mid-day does not lose the morning
  minimum.
- Computed data entries `<alias>_min_today` / `<alias>_max_today`
  (unit `°C`, category = source binding category).
- UI:
  - Desktop dashboard `WeatherStationWidget`: outdoor min/max next to
    the hero temperature.
  - Mobile dashboard `MobileWidgetCard`: outdoor min/max line + rows in
    the bottom sheet.
  - `WeatherPanel` (equipment detail): min/max in the outdoor module
    section and in the indoor section.
- FR/EN i18n.

### Out of scope

- Zone view `CompactEquipmentCard` (user chose not to include it).
- Min/max for non-weather equipment types (thermostats, pool, ...) —
  the tracker is scoped to `type === "weather"`; generalizing is a
  possible future spec.
- Timestamps of the min/max ("min at 06:42") — value only for now.
- Seeding from InfluxDB history on first install — the envelope starts
  from the first sample after the feature ships; it self-corrects the
  next day.
- Outlier filtering (a sensor glitch becomes the min/max of the day).

## Acceptance criteria

- [x] AC1 — A `weather` equipment exposes `<alias>_min_today` and
      `<alias>_max_today` computed entries for each bound temperature
      (indoor and outdoor) once at least one sample was observed today.
- [x] AC2 — The values reset at local midnight (server timezone): the
      first sample of a new day becomes both min and max.
- [x] AC3 — A Sowel restart during the day preserves the current
      envelope (SQLite-backed).
- [x] AC4 — Desktop widget, mobile widget and WeatherPanel display the
      outdoor min/max; WeatherPanel also displays the indoor min/max.
- [x] AC5 — A station whose temperature binding never updates shows no
      min/max (no placeholder noise), and non-weather equipments are
      untouched.
- [x] AC6 — Deleting the equipment removes its persisted rows.

## Edge cases

| Case                                          | Expected                                   |
| --------------------------------------------- | ------------------------------------------ |
| Non-numeric / null temperature sample         | Ignored                                    |
| First sample of the day                       | min = max = sample                         |
| Sample arrives with day != stored day         | Envelope reset to that sample (rollover)   |
| Restart mid-day                               | Envelope reloaded from SQLite              |
| Several temperature bindings on one equipment | Tracked independently per alias            |
| Equipment removed                             | State and rows deleted                     |
| Equipment type != weather                     | Ignored by the tracker                     |
| Binding category not temperature\*            | Ignored (humidity, rain, wind, battery...) |
