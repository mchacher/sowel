# Spec 175 — A power reading is judged on its own cadence

## Problem

Four surfaces decide whether a power reading may be drawn as a live measurement, and they do not
agree.

| Surface                                                                                          | Window today |
| ------------------------------------------------------------------------------------------------ | ------------ |
| Live energy banner (`ui/src/components/energy/live-staleness.ts`)                                | 10 min       |
| Equipment tiles and widgets (`ui/src/lib/power-reading.ts`)                                      | 2 min        |
| Zone power total (`src/zones/zone-aggregator.ts`)                                                | 2 min        |
| Submeter breakdown and the `?role=submeter` feed (`submeter-helpers.ts`, `routes/equipments.ts`) | 2 min        |

All four call the same classifier, `classifyPowerReading`. They differ only in the budget they hand
it, and that budget is a constant picked from the equipment's type rather than from anything the
source itself does.

Two consequences, both observed:

- **One reading, three answers.** A meter polled every 300 s, three minutes into a healthy cycle:
  the banner stays silent (correct), the dashboard tile prints "outdated", and the zone total drops
  its watts. That is the divergence `reading-freshness.ts` was created to end (#832), reintroduced
  by #882 having to widen one surface alone.
- **The constant fits nobody.** Ten minutes is twice the slowest cadence in the registry, so a
  Shelly reporting at 1 Hz has to die for ten minutes before anything says so, while a cloud poller
  at 300 s is still called outdated by three surfaces out of four.

The engine already holds what would settle it. `device_data.last_updated` carries the real arrival
times, and every polled plugin exposes `getPollingInfo(): { intervalMs }` with the interval the user
actually configured, not a default guessed here.

## Also fixed: an alias that never existed

`reading-freshness.ts` special-cases an alias `demand_5min` and states that "a Legrand NLPC meter has
no `power` channel at all". Both halves are wrong, and the investigation behind #883 established it:

- `sowel-plugin-legrand-energy` declares `power`, `energy`, `autoconso`, `injection` and
  `demand_30min`, and has never, in any commit, declared `demand_5min`.
- No plugin in the registry produces that alias. The only declaration of `key: "demand_5min"` in the
  whole history of this repository is a fixture in `src/zones/zone-aggregator.test.ts`.

So `LIVE_POWER_ALIASES` carries a fallback that fires for no real device, and the slow-budget branch
of `powerBudgetFor` is unreachable. They are removed here rather than carried into the new rule.

## Requirements

### FR1 — The budget is derived from the source's cadence

For every power binding, the engine resolves a freshness budget in this order:

1. **Observed cadence.** The median of the last intervals between arrivals on that `device_data`
   row, once at least 3 intervals are known.
2. **Declared cadence.** `getPollingInfo().intervalMs` of the integration backing the device.
3. **Learning grace.** Neither known yet: the conservative 10-minute window in force today.

The budget is `clamp(2.5 x cadence, 120 s, 30 min)`.

### FR2 — The budget travels on the binding

`DataBindingWithValue` carries `freshnessBudgetMs`. Every surface passes it to
`classifyPowerReading` instead of computing a window of its own. No surface restates the rule,
because there is no rule left on the surfaces to restate.

### FR3 — One verdict per reading

At any instant, the banner, the tile, the zone total and the submeter feed give the same answer for
the same binding.

### FR4 — Detection scales with the source

A meter reporting at 1 Hz that dies is flagged within 2 minutes. A meter polled every 300 s that
dies is flagged within 12.5 minutes. Neither is flagged while reporting on its normal cadence.

### FR5 — The dead alias goes

`demand_5min` is removed from `LIVE_POWER_ALIASES` and from the budget rule. `powerBudgetFor` and its
`solar_panel` special case disappear: a 300 s Tasmota solar bridge earns its window from its cadence
like everything else.

## Acceptance criteria

- [ ] A binding whose source has reported 5 times at 1 s intervals carries `freshnessBudgetMs` of
      120 000 (the floor, not 2 500).
- [ ] A binding on a device whose integration declares `intervalMs: 300000` carries 750 000 before
      any arrival is observed.
- [ ] A binding on a device whose integration declares `intervalMs: 3600000` carries 1 800 000 (the
      ceiling).
- [ ] A binding with neither observed nor declared cadence carries 600 000.
- [ ] Given one equipment and one instant, `resolvePowerReading`, `readSubmeterReading`, the zone
      aggregator and the `?role=submeter` feed return the same verdict, for a source at 1 Hz and for
      a source at 300 s.
- [ ] A 300 s source three minutes silent is `current` on all four surfaces.
- [ ] A 1 Hz source three minutes silent is `stale` on all four surfaces.
- [ ] A single irregular gap among ten one-second intervals does not move the budget (median, not
      mean).
- [ ] A silence longer than the ceiling starts the series again: the budget falls back until three
      fresh intervals are known, rather than being computed from before the gap.
- [ ] No code path selects a binding on the alias `demand_5min`. What remains of the name is the
      tests asserting it is not honoured, and the comments recording why it went.
- [ ] The Dashboard widget and the mobile card show a live wattage for a meter bound on `power`.

## Scope

**In**

- The cadence tracker and the budget resolution.
- `freshnessBudgetMs` on the binding payload, and the four surfaces consuming it.
- Removal of `demand_5min`, of `powerBudgetFor` and of the `solar_panel` special case.
- The two surfaces that looked the dead alias up and nothing else — `EquipmentWidget` and
  `MobileWidgetCard` — now ask `pickLivePowerBinding`, the selection the compact card already used.
  Removing the alias without this would leave them selecting nothing at all; they have in fact been
  printing a dash over every real meter, which is what looking up an alias no plugin produces gets
  you. Not planned as part of this spec, found by removing the alias.

**Out**

- **The spec 116 equipment status.** `isStaleBinding` keeps its per-category windows, so the
  `degraded` dot, the alerts and everything reading `status` are untouched. Sizing those windows on
  the allowed report interval is the follow-up `equipment-status.ts` already documents, and it moves
  a surface this spec deliberately does not.
- **Non-power categories.** Temperature, humidity and the rest keep `STREAMING_TIMEOUT_MS`.
- **Persistence.** The estimator lives in memory and is rebuilt from arrivals after a restart. No
  migration, no write on the hot path.

## Edge cases

| Case                                                    | Behaviour                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Restart, no arrival seen yet                            | Declared cadence if the integration exposes one, else the 10-minute grace. Nothing reads "outdated" because Sowel rebooted.                                                                                                                                                                 |
| A source that dies and never comes back after a restart | Stays on the grace budget forever. Conservative on purpose: an estimator with no samples cannot claim a tight window.                                                                                                                                                                       |
| A source with one irregular gap                         | The median of the ring absorbs it. One outlier among ten samples does not move a median, which is why it is not a mean.                                                                                                                                                                     |
| A source returning from an outage longer than 30 min    | Discontinuity, not irregularity: the series starts again, so a stale history cannot describe what the source does now. This is also what protects the estimator from a database restore, which deletes `device_data` rows through raw SQL and reaches neither call site that forgets a row. |
| Two arrivals inside the same second (burst)             | Pulls the observed cadence down; the 120 s floor makes it harmless.                                                                                                                                                                                                                         |
| A user setting a 60 s poll on a cloud plugin            | Declared cadence is read live, so the budget follows to 150 s without a code change.                                                                                                                                                                                                        |
| A user setting a 3600 s poll                            | Clamped to the 30-minute ceiling, so the reading reads outdated between polls. Stated, not hidden: past 12 min of silence, a dead source is the more likely reading, and the device-offline path is what covers a legitimately slow integration.                                            |
| A binding whose device row was deleted and recreated    | New `device_data` id, empty ring, grace budget until three arrivals.                                                                                                                                                                                                                        |
| An old client that does not read `freshnessBudgetMs`    | Field is additive and optional; the surfaces fall back to the same 10-minute grace.                                                                                                                                                                                                         |
