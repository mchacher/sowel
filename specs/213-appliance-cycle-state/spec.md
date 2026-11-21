# Spec 213 — An appliance's run state derived from its power

**Status**: Draft 2026-11-21.

## Context

The washing machine on the maintainer's instance (`Lave-linge`, type `appliance`) gets its run
state from the SmartThings plugin: `state` (`appliance_state`), `job_phase`, `progress`,
`remaining_time`. Samsung puts the SmartThings API behind a paid plan around 2026-12-15, after
which those bindings stop updating. The machine is already metered by a SONOFF S60ZBTPF Zigbee
plug (`power`, `energy`, `voltage`, `current`, bound since 2026-11-10).

Four complete cycles were recorded on the plug between 2026-11-11 and 2026-11-15, plus one on
2026-11-21, and compared with the SmartThings `state` of the same cycles:

| Start (local) | Length | Energy   | Heating | Longest stretch < 10 W mid-cycle |
| ------------- | ------ | -------- | ------- | -------------------------------- |
| 11-11 14:12   | 83 min | 1.05 kWh | 31 min  | 100 s                            |
| 11-13 07:28   | 72 min | 0.32 kWh | 7 min   | 38 s                             |
| 11-13 12:13   | 70 min | 0.36 kWh | 8 min   | 38 s                             |
| 11-15 16:01   | 66 min | 0.34 kWh | 8 min   | 46 s                             |

- Machine off: 0 W. Powered on and idle (display): about 6 W, never above 6.4 W.
- Inside a cycle the power never drops below about 5 W and never reaches 0 W. The plug reports
  every 30 to 40 s while the power moves (largest gap seen: 150 s).
- At the end the power sits at about 5 W, then the machine switches itself off: 0 W 3 to 5 min
  after the end, every time.
- The rule "running above 15 W, finished after 5 min below 10 W" lands 0 to 3 min from the
  SmartThings `ready` on every cycle (07:45 vs 07:42, 12:28 vs 12:27, 16:12 vs 16:12).

Today, three surfaces already get the plug wrong or will lose their input:

1. The four appliance surfaces (`AppliancePanel`, the mobile card, the desktop widget and the
   compact home card) treat the machine as on only when `power === true`
   (`AppliancePanel.tsx:23`, `MobileWidgetCard.tsx:489`, `EquipmentWidget.tsx:1730`,
   `CompactEquipmentCard.tsx:801`). From the plug, `power` is a number of watts, so all show
   **Off** even mid-cycle, now.
2. The "lessive terminée" `state-watch` instance alarms on `state == ready`. It dies with
   SmartThings, and `ready` also means "idle", so its alarm is up most of the day.
3. The `state` history disappears with the binding.

The core already derives a state that no device reports: a gate's `state` is a **virtual data
binding** built from its contacts (`equipment-manager.ts:1715`, `buildGateStateBinding`), and a
pool cover's `cover_state` likewise. This spec adds a third one, for appliances, from power.

## Goals

1. An `appliance` equipment with a measured power and no bound `state` gets a `state` the
   surfaces, recipes and history already know how to read.
2. The state tells a cycle that has just finished apart from a machine that is merely on, so a
   "cycle finished" notification fires once, at the end.
3. The detection thresholds can be set per equipment.

## Non-Goals

- `job_phase`, `progress`, `remaining_time`: not derivable from power alone.
- A `paused` state: a pause is indistinguishable from a mid-cycle dip on the power curve.
- Other equipment types (a dishwasher or dryer is an `appliance` and is covered; a `switch`
  plug driving something else is not).
- Persisting a `finished` state across a restart (see Edge Cases).
- The generic fix of #936 (classify every `appliance_state` series by enum cardinality, declare
  `enumValues` in the SmartThings plugin). Only the derived series is charted correctly here.
- Changing the `state-watch` recipe: a virtual binding is a binding, the recipe needs nothing.

## Functional Requirements

### FR1 — When the derived state applies

1. The derived `state` is injected on an equipment when **all** hold: its type is `appliance`;
   it has a data binding aliased `power` whose type is `number`; it has **no** data binding
   aliased `state`.
2. A bound `state` always wins. On the maintainer's instance the derived state appears once the
   SmartThings `state` binding is removed.
3. It is exposed as a virtual data binding, like the gate's: id
   `virtual:appliance_state:<equipmentId>`, alias `state`, type `enum`, category
   `appliance_state`, `enumValues: ["off", "ready", "running", "finished"]`, `stale` following
   the `power` binding's staleness.

### FR2 — The state machine

Inputs: the live `power` value `P` (W) and three thresholds per equipment (FR3): `startW`,
`endW`, `endDelayS`. A fixed constant `OFF_W = 1` W.

| From                       | Condition                                       | To                         |
| -------------------------- | ----------------------------------------------- | -------------------------- |
| any                        | `P < OFF_W`                                     | `off`                      |
| `off`                      | `OFF_W ≤ P ≤ startW`                            | `ready`                    |
| `off`, `ready`, `finished` | `P > startW`                                    | `running`                  |
| `running`                  | `P < endW` without interruption for `endDelayS` | `finished`                 |
| `running`                  | `P ≥ endW` while the delay runs                 | `running`, delay cancelled |
| `running`, delay running   | `P < OFF_W`                                     | `finished`, then `off`     |
| `ready`, `finished`        | `OFF_W ≤ P ≤ startW`                            | unchanged                  |

1. The end delay is a timer started on the first sample below `endW`, so a plug that stops
   reporting while the power is flat still ends the cycle.
2. `P` null or absent (no reading yet): the virtual binding is injected with a `null` value, so
   the history writer and the history list know the series from the start; surfaces read a
   `null` state as no state. (Amended during implementation: the first draft injected nothing.)
3. **Switched off during the end delay.** The recorded cycles show the machine switching itself
   off 160 s to 5 min after its end, so often before a 5 min delay runs out (2026-11-13 07:28:
   off 160 s after the last sample above 10 W). Switched off while the delay runs, the machine
   passes through `finished` (one event) and then `off` (a second event), so every completed
   cycle is announced. Switched off with no delay running (mid-cycle, by hand), it goes straight
   to `off`. (Found while replaying the fixtures; the first draft lost those ends.)
4. Every transition emits `equipment.data.changed` with alias `state`, the new value and the
   previous one. No event when the state does not change.
5. Each transition is logged at `debug`; the `running → finished` transition at `info` with the
   cycle's length.

### FR3 — Per-equipment thresholds

1. New optional equipment field `applianceCycle: { startW, endW, endDelayS } | null`. Absent or
   `null` means the defaults: `startW = 15`, `endW = 10`, `endDelayS = 300`.
2. Validation on create/update: `OFF_W < endW ≤ startW ≤ 5000`, `30 ≤ endDelayS ≤ 3600`,
   integers for `endDelayS`. A violation is a 400 with the field named.
3. Settable through `PUT /api/v1/equipments/:id` (admin only, like the other equipment fields)
   and from a new **Cycle detection** section on the equipment page of an `appliance`
   (admin only): three number fields pre-filled with the current values (the delay in minutes),
   saved on blur, and a reset to the defaults when a set is stored.
4. While the equipment has a bound `state`, the section stays editable and says the derived
   state is inactive because a device reports one.
5. A change of thresholds re-evaluates the state at once from the current power.

### FR4 — History

1. The derived `state` is historized: HistoryWriter writes it like an enum binding (label in
   `value_string`, declared index in `value_number`, #434). It is not toggleable in v1.
2. `GET /api/v1/history/bindings/:equipmentId` lists it, with `virtual: true` and its
   `enumValues`; the gate and cover virtual bindings stay hidden as today.
3. The history chart classifies an `appliance_state` series that declares more than two
   `enumValues` like the multi-value cover and gate states: a plain numeric series of the
   index, not the 0/1 states axis.

### FR5 — Surfaces

1. The four appliance surfaces (`AppliancePanel`, `MobileWidgetCard`, `EquipmentWidget`,
   `CompactEquipmentCard`) take the machine as on when `state` is known and not `off`; when
   `state` is absent, a boolean `power` (`true`) or a numeric `power ≥ 1` W. One helper,
   `ui/src/lib/appliance.ts`. This also fixes the "Off mid-cycle" bug while SmartThings still
   runs.
2. They render the two new values with their own labels: `ready` → "Prêt" / "Ready",
   `finished` → "Terminé" / "Finished". `running` keeps "En cours" / "Running".
3. The recipe data-key picker already lists `state` (it reads `dataBindings`); nothing to do.

## Acceptance Criteria

- [ ] An `appliance` with a numeric `power` and no `state` binding exposes a virtual `state`
      in `dataBindings`, with the four declared values.
- [ ] An `appliance` with a bound `state` exposes only the bound one.
- [ ] Replaying the recorded 2026-11-13 07:28 cycle yields `running → finished → off` (the plug
      jumps from 0 W straight above 15 W), `finished` arriving when the machine switches off.
- [ ] Replaying the 2026-11-11 cycle (100 s dip at 14:04 UTC) yields one `running` only.
- [ ] A mid-cycle dip below `endW` shorter than `endDelayS` does not end the cycle.
- [ ] The thresholds are saved, validated (400 on a bad set), and change detection at once.
- [ ] The derived `state` is written to InfluxDB and listed by `/history/bindings`.
- [ ] The four appliance surfaces show the machine on mid-cycle with plug power.
- [ ] A `state-watch` instance on `state == finished` raises once at the end of a cycle and
      clears when the machine switches off.

## Edge Cases

- **Restart mid-cycle.** The state is rebuilt from the current power: `> startW` → `running`,
  `< OFF_W` → `off`, otherwise `ready`. A restart during the final 5 min, or while `finished`,
  yields `ready`: the end notification of that cycle is lost, never doubled. Accepted.
- **Restart while the end delay runs.** Same as above: the delay is not resumed.
- **Machine switched off by hand mid-cycle.** `P` drops to 0 → `off` directly, no `finished`.
- **Machine that does not switch itself off.** It stays `finished` until it is switched off or
  starts again.
- **Delayed start.** The machine waits at about 6 W → `ready`, until the cycle draws.
- **Power binding goes stale** (plug offline). The state keeps its last value; the binding is
  marked stale like its source. No transition is invented.
- **Equipment type changed away from `appliance`, or `power` unbound.** The virtual binding
  disappears at the next read; the tracker forgets the equipment.
- **`power` bound as a boolean** (a smart appliance reporting on/off). FR1 does not apply.

## Docs Delta

- `docs/user/equipments.md` + `docs/user/equipments.fr.md`, section Appliances: the run state
  derived from a metering plug, its four values, the Cycle detection settings and their
  defaults, and that a bound state wins.
- `docs/technical/data-model/equipments.md` (EN only, no FR page): the `applianceCycle` field,
  the virtual `state` binding next to the gate and cover ones.
- `docs/technical/api-reference.md` + `docs/technical/api-reference.fr.md`: `applianceCycle` on
  `PUT /equipments/:id`, and `virtual` / `enumValues` on `GET /history/bindings/:equipmentId`.
- Screenshots: none to retake (no screenshot of the appliance panel today).
