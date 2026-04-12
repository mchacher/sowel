# Spec 065 — Freecooling recipe plugin

## Context

Users who sleep with shutters partly open for fresh air need them closed before sunrise to avoid being woken by daylight. This recipe automates that: close all shutters in a zone X minutes before sunrise.

## Goals

1. Close all shutters in a zone (and sub-zones) before sunrise
2. Configurable offset before sunrise (default 120 min)
3. Only close shutters that are currently open (position > 0)
4. No shutter selection — applies to all shutters in the zone tree

## Non-Goals

- Reopening shutters after sunrise (manual or other recipe)
- Per-shutter selection or per-shutter offset
- State pills on zone page
- Night/day mode integration

## Recipe Parameters (Slots)

| Slot ID         | Type   | Required | Default | Description                                        |
| --------------- | ------ | -------- | ------- | -------------------------------------------------- |
| `zone`          | zone   | yes      | —       | Zone (and sub-zones) where shutters will be closed |
| `offsetMinutes` | number | yes      | 120     | Minutes before sunrise to close shutters           |

## Behavior

### Scheduling

1. On start, read `sunrise` from `ZoneAggregatedData` of ROOT_ZONE_ID
2. Compute trigger time: `sunrise - offsetMinutes`
3. Schedule a `setTimeout` for that time
4. After each trigger, listen for the next `sunlight.changed` event to reschedule (sunrise shifts daily)

### Trigger

1. Get all equipments of type `shutter` in the zone and all descendant zones
2. For each shutter: read position binding — if position > 0 (open), send order `position = 0`
3. Log: "Fermeture de X volets — lever du soleil dans Y min"
4. Skip shutters already at position 0

### Sunrise source

`ctx.zoneAggregator.getByZoneId(ROOT_ZONE_ID)?.sunrise` — ISO timestamp, already available from `SunlightManager`.

## Logging

- Start: "Recette démarrée — zone X, fermeture Ymin avant lever du soleil"
- Trigger: "Fermeture de 3 volets — lever du soleil dans 120 min"
- Skip: "Aucun volet ouvert — rien à faire"
- Per-shutter: "Volet Chambre fermé (était à 75%)"

## Acceptance Criteria

- [ ] Recipe plugin installable via PackageManager
- [ ] Shutters close at `sunrise - offset` each day
- [ ] Only open shutters are closed (position > 0)
- [ ] All shutters in zone + sub-zones are included
- [ ] Offset is configurable (1-300 min)
- [ ] Reschedules correctly when sunrise shifts day-to-day
- [ ] Survives Sowel restart (reschedules from current sunrise)
- [ ] TypeScript compiles clean

## Edge Cases

- **Sunrise not available** (InfluxDB down, no sunlight config): log warning, retry on next `sunlight.changed` event
- **Offset larger than time until sunrise** (e.g. sunrise in 30 min, offset 120 min): trigger immediately — it's already past the target time
- **No shutters in zone**: log "Aucun volet dans la zone", do nothing
- **Shutter offline**: executeOrder fails → log error, continue with others

## Related

- Uses: `SunlightManager` data via `ZoneAggregatedData.sunrise`
- Repo: `mchacher/sowel-recipe-freecooling` (new)
- Pattern follows: `sowel-recipe-auto-watering`
