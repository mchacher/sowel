# Sunrise/Sunset — Home Daylight Awareness

## Summary

Compute sunrise and sunset times based on the home's geographic location. Expose these values (plus a configurable `isDaylight` boolean) in the root zone's aggregated data. This enables recipes to use daylight as a condition without requiring a lux sensor.

## Why

- Many rooms don't have a luminosity sensor
- Recipes like "turn on lights at dusk" or "close shutters at night" need a daylight signal
- The `isDaylight` flag with configurable offsets is more practical than raw sunrise/sunset times: it accounts for the fact that it's already dark well before sunset and still dark after sunrise

## Acceptance Criteria

- [ ] Home location (latitude, longitude) configurable via Administration > Settings UI
- [ ] Sunrise offset and sunset offset (minutes) configurable via Settings UI
- [ ] `sunrise`, `sunset` (HH:mm format), and `isDaylight` (boolean) available in root zone aggregated data
- [ ] `isDaylight` transitions emit `zone.data.changed` events (enabling recipe conditions)
- [ ] `isDaylight = true` when `now > sunrise + sunriseOffset AND now < sunset - sunsetOffset`
- [ ] Values recomputed daily at midnight and on settings change
- [ ] `isDaylight` checked every minute for transitions
- [ ] UI displays sunrise/sunset in ZoneAggregationPills for root zone
- [ ] Works without location configured (fields are null, no errors)

## Scope

### In Scope

- Location settings (lat, lon, sunrise offset, sunset offset)
- Daily sunrise/sunset computation (library: `suncalc`)
- `isDaylight` boolean with configurable offsets
- Root zone aggregated data enrichment
- ZoneAggregationPills UI display
- Recipe conditions can reference `isDaylight`

### Out of Scope

- Temporal triggers ("at sunrise", "30 min before sunset") — deferred
- Dawn/dusk/solar noon/golden hour — future enhancement
- Weather-based cloud cover adjustment
- Per-zone location (single home location only)

## Edge Cases

- No location configured → `sunrise`, `sunset`, `isDaylight` all null
- Polar regions (midnight sun / polar night) → `suncalc` handles this correctly
- Settings changed mid-day → immediate recomputation
- Engine restart → immediate computation on startup

## Settings

| Key                  | Label                | Type   | Default | Description                                  |
| -------------------- | -------------------- | ------ | ------- | -------------------------------------------- |
| `home.latitude`      | Latitude             | number | —       | Geographic latitude (e.g. 48.8566)           |
| `home.longitude`     | Longitude            | number | —       | Geographic longitude (e.g. 2.3522)           |
| `home.sunriseOffset` | Sunrise offset (min) | number | 30      | Minutes after sunrise before isDaylight=true |
| `home.sunsetOffset`  | Sunset offset (min)  | number | 45      | Minutes before sunset when isDaylight=false  |
