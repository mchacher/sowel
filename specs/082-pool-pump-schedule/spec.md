# Spec 082 — Pool Pump Schedule Recipe

## Summary

A new recipe plugin `pool-pump-schedule` that drives a `pool_pump`
equipment on a fixed daily schedule. The user configures up to three
time windows per day; for each active window the recipe turns the pump
ON at the start time and OFF at the end time. It is a deliberately
minimal v1 — weather, water-temperature and forecast conditions are
explicitly out of scope and will be added later once the sensors and
data exist.

## Why

Pool pumps need to run a few hours per day to filter the water. Today
the user either toggles the pump manually from the dashboard or wires
a physical timer on the relay. Sowel already has all the plumbing —
pool_pump equipment type, reactive event bus, recipe engine — so
shipping a scheduled on/off recipe is the obvious first brick.

## Scope

### In scope

- A single recipe plugin distributed from its own GitHub repo
  (`sowel-recipe-pool-pump-schedule`).
- One `pool_pump` equipment per recipe instance.
- Up to **3 time slots** per instance (slot 1 required, slots 2 and 3
  optional).
- Each slot has a **start time** (HH:MM) and an **end time** (HH:MM).
  If `end < start`, the window is treated as crossing midnight (pump
  stays on until the next day).
- Fires a JS timer at each start time → `executeOrder(pumpId, "state",
"ON")`. Fires a second timer at the end time → `executeOrder(pumpId,
"state", "OFF")`. Both timers persist only for the current day and
  reschedule themselves for the following day on fire.
- Stopping the instance mid-cycle (user disables it or deletes it)
  **overrides** the schedule and issues an OFF command.
- Registration in `plugins/registry.json` (bump to `1.0.0`).

### Out of scope (follow-up)

- Water temperature / solar / weather-driven adaptation.
- Filtration duration computed from water temperature (rule of thumb:
  run time ≈ water temp ÷ 2).
- Rain / cloud / forecast skip logic.
- Manual override commands from the dashboard merged with the
  schedule (the dashboard toggle still works; it simply stays where
  the user left it until the next scheduled event flips it).

## User stories

- **US-1** — As a user, I want to schedule my pool pump to run every
  day from 10:00 to 14:00 and from 20:00 to 22:00, so I don't have to
  think about it.
- **US-2** — As a user, I want to run the pump at night (22:00 →
  06:00) during off-peak electricity hours; the recipe must handle
  the midnight crossing correctly.
- **US-3** — As a user, I want to disable the recipe temporarily (on
  vacation, pool closed, …) and the pump must stop if it's running
  when I disable.
- **US-4** — As a user, I want to edit my schedule without deleting
  and recreating the instance; editing the parameters reschedules
  everything for the next window.

## Acceptance criteria

- [x] Recipe appears in the Sowel plugin store after registry update
      and can be installed via the plugin page.
- [x] Creating an instance requires a `pool_pump` equipment and at
      least one slot (start + end).
- [x] At `slotN_start` the pump receives `ON` on its `state` alias.
- [x] At `slotN_end` the pump receives `OFF`.
- [x] When `slotN_end < slotN_start`, the OFF fires on the next day
      (midnight-crossing slot).
- [x] Disabling the instance while a slot is active sends `OFF` and
      clears the completion timer.
- [x] Re-enabling the instance reschedules from the current time.
- [x] Validation: saving a slot with a start but no end (or vice
      versa) raises a clear error.
- [x] Validation: saving `start == end` raises an error (empty window
      makes no sense).
- [x] Recipe logs each ON / OFF / skipped event with the slot name and
      pump name in plain French.

## Edge cases

- **Recipe enabled mid-window** — if the instance is enabled at 11:00
  while a slot is 10:00→14:00, should the pump turn ON immediately?
  **v1 behaviour: no.** The recipe only fires on slot boundaries; the
  user can toggle manually if they want the pump on right now.
- **Sowel restart mid-window** — same as above: on restart the
  recipe reschedules start/end timers for the next occurrence. If the
  pump was ON from a previous start, it stays ON (Tasmota keeps relay
  state) until the end time fires as scheduled. No catch-up logic.
- **Start == end** — rejected by validation.
- **Overlapping slots** — allowed but meaningless (we just fire the
  commands in order). Not worth policing.
- **Pump equipment deleted while recipe runs** — recipe logs an error
  on next fire and keeps going (same behaviour as other recipes).
