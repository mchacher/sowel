# Spec 130 — Auto-watering per-slot weekdays (+ multi-select recipe slot)

## Context

GitHub issue #306 (Romain / alpitux). The `auto-watering` recipe schedules up to
3 daily time slots (time + duration). Every slot fires **every day**. The user
wants to water at different times depending on the day of the week — e.g. water
at **07:30 on school days** but at **09:00 on Wednesday and the weekend**
(the pump is audible from the bedrooms and would wake the children early).

Today there is no way to restrict a slot to specific weekdays.

## Goal

Add an **optional** per-slot "days of week" selector to the `auto-watering`
recipe. Selecting no day (the default) keeps the current behavior — water every
day — so existing recipe instances are unchanged with no migration.

This requires a small, reusable **core** addition: render a recipe `select` slot
with `list: true` as a **multi-select** (day chips) in the recipe form. The
`select` slot type already exists (spec 126); `list` is currently honored only
for `equipment` slots.

## Scope

### In scope

- **Core (this repo)**: `ZoneRecipesSection.tsx` renders a `select` + `list: true`
  slot as a multi-select chip group, in both recipe render paths (edit an existing
  recipe, add a new recipe). Value stored as a comma-joined list of option values,
  reusing the existing list-value convention.
- **Recipe (`sowel-recipe-auto-watering`)**:
  - New optional slot `slot{1,2,3}_days` (type `select`, `list: true`, 7 weekday
    options), grouped with its créneau.
  - Scheduler restricts each slot to its selected weekdays; empty selection = all
    days. Computes the next allowed occurrence.
  - FR/EN i18n for the field and the day options.

### Out of scope (explicitly excluded)

- **Public holidays / school holidays.** Sowel has no holiday/vacation calendar
  source; baking a country-specific calendar into a generic recipe is rejected.
  Deferred; a later option is to drive it via Modes. Weekday selection already
  covers the primary need (weekday vs Wednesday/weekend differentiation).
- **Per-valve durations.** The single per-slot duration is unchanged.

## Acceptance criteria

- [x] AC1 — In the auto-watering recipe form, each créneau shows an optional
      **Jours / Days** field rendered as 7 toggle chips (Mon…Sun).
- [x] AC2 — Default = no day selected → the slot waters **every day**; existing
      instances keep working with **no migration** and no behavior change.
- [x] AC3 — When one or more days are selected, the slot triggers **only** on
      those weekdays; the scheduler arms the next allowed occurrence.
- [x] AC4 — Romain's case works end to end: slot1 `07:30` = Mon/Tue/Thu/Fri,
      slot2 `09:00` = Wed/Sat/Sun.
- [x] AC5 — Core renders a `select` + `list: true` slot as a multi-select chip
      group in **both** recipe render paths; the value round-trips (save → reload
      → same chips selected). A legacy/plain `select` (no `list`) is unchanged.
- [x] AC6 — Rain skip, forecast skip, and resume-after-restart behavior are
      unchanged.
- [x] AC7 — Weekday is evaluated in the recipe process timezone, consistent with
      the existing `msUntilTime` local-time behavior (Sowel sets `TZ=Europe/Paris`).

## Edge cases

| Case                                      | Expected                                                         |
| ----------------------------------------- | ---------------------------------------------------------------- |
| No day selected (empty / absent param)    | Every day (retro-compat)                                         |
| All 7 days selected                       | Every day                                                        |
| Days selected but slot time empty         | Slot inactive (unchanged: a slot needs time + duration)          |
| Today is not an allowed day               | Next fire = the next allowed weekday at HH:MM                    |
| Today is allowed but HH:MM already passed | Next fire = the next allowed weekday at HH:MM (may be next week) |
| Invalid/unknown day token in params       | Ignored (filtered out)                                           |
| Two slots, different day sets             | Scheduler fires each on its own next allowed occurrence          |
