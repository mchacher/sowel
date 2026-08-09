# Spec 138 — Read-only tariff helper for recipes

## Context

A load-shifting recipe — water heater, pool pump, EV charger — has to know
when energy is cheap. The instance already knows: the HP/HC schedule is
configured under **Settings → Administration → Energy tariff**, stored in
settings under `energy.tariff`, and used by `TariffClassifier` to split
history into `energy_hp` / `energy_hc`.

But `RecipeContext` exposes no way to read it (`eventBus`,
`equipmentManager`, `zoneManager`, `zoneAggregator`, `logger`, `state`,
`log`, `helpers`, `dispatchOrder`). Every recipe that cares about off-peak
hours therefore re-asks the user for hours they already entered, in slots
of its own. That is duplicated configuration that silently drifts: change
the tariff page and the recipes keep firing on the old hours.

Reported by a user building a `water-heater-smart` recipe: _"les heures
creuses sont déjà présentes dans la conf de Sowel, donc va la récupérer
plutôt que de redemander"_.

## Goal

Expose the configured tariff schedule to recipe packages, **read-only**, on
the same pattern as `getSunlight()` (spec 126).

## Scope

### In scope

- `RecipeTariff` type in `src/shared/types.ts`.
- `getTariff(): RecipeTariff` added to `RecipeHelpers`.
- `RecipeManager` takes a `TariffClassifier | null` and builds the snapshot.
- `slotRanges()` / `isWithinSlot()` extracted and exported from
  `TariffClassifier`, so schedule interpretation has one definition instead
  of two.
- Docs in `docs/technical/recipe-development.md`.

### Out of scope

- **Tariff prices.** See "Security" below.
- Any write path. The tariff is owned by the settings page.
- A `tariff.changed` event. A recipe re-reads the snapshot on its own
  cadence; adding an event can follow if a recipe needs to re-arm timers
  the instant the schedule changes.
- Reading _tomorrow's_ schedule. `offPeakToday` covers the current
  day-of-week, which is what a same-night placement needs.

## Contract

```typescript
interface RecipeTariff {
  configured: boolean;
  offPeakToday: TariffSlot[]; // { start, end, tariff: "hc" }
  isOffPeakNow: boolean | null;
}
```

`offPeakToday` holds the HC slots of the schedule covering the current
local day-of-week. A slot whose `end` is not after its `start` wraps past
midnight (`22:00 → 06:00`), the same convention energy classification uses.
When nothing is configured, `configured` is `false`, the list is empty and
`isOffPeakNow` is `null` — recipes fall back to their own slots.

## Security

Two properties are deliberate, because a recipe package is **third-party
code** running in-process that can republish anything it is handed
(instance state is pushed over the WebSocket; MQTT and notification
publishers reach further still).

1. **No mutation path.** `TariffClassifier.getConfig()` returns its cached
   object _by reference_. Handing that to a recipe would let a package
   rewrite the schedule that energy billing runs on. `buildTariffSnapshot()`
   copies every field out by value, and there is no setter.

2. **Prices are not exposed.** Knowing _when_ energy is cheap is sufficient
   to schedule a load; what it costs is commercial data with no bearing on
   the decision. `config.prices` is read to determine nothing and never
   leaves the manager.

Unchanged by this spec, but worth recording: `GET
/api/v1/settings/energy/tariff` requires authentication (all `/api/` routes
do, per `auth-middleware.ts`) but **not** the admin role, since the spec 131
role gate only covers mutating methods. `GET /api/v1/settings` does check
admin explicitly in its handler. Aligning the two is a separate change.

## Acceptance criteria

- [x] AC1 — `ctx.helpers.getTariff()` is callable from an external recipe.
- [x] AC2 — Unconfigured instance yields `{ configured: false,
    offPeakToday: [], isOffPeakNow: null }`.
- [x] AC3 — Only HC slots of the schedule covering today are returned;
      other days' schedules do not leak in.
- [x] AC4 — `isOffPeakNow` is correct across a midnight-wrapping slot.
- [x] AC5 — Mutating the returned snapshot leaves the stored config intact,
      and the next call still returns the real schedule.
- [x] AC6 — No price value is reachable through the snapshot.
- [x] AC7 — `classify()` behaviour is unchanged by the `slotRanges`
      extraction (new `tariff-classifier.test.ts` covers prorata,
      wrap, unconfigured, unparseable, and uncovered-day cases).

## Edge cases

| Case                                        | Expected                                                |
| ------------------------------------------- | ------------------------------------------------------- |
| No tariff configured                        | `configured: false`, recipe uses its own slots          |
| Settings value is not valid JSON            | Same as unconfigured (classifier logs, returns null)    |
| Schedule covers weekdays only, today Sunday | `offPeakToday: []`, `configured: true`                  |
| Slot ends at `"00:00"`                      | Read as 24:00, not as an empty slot                     |
| Slot wraps midnight                         | Two ranges; `isOffPeakNow` true on both sides           |
| `TariffClassifier` unavailable (null)       | Same as unconfigured                                    |
| Classifier throws                           | Logged, treated as unconfigured — never breaks a recipe |
