# Energy arbiter: predictive and adaptive roadmap

Status: draft, not a spec yet. Written 2026-08-23.
Scope: `src/energy/capacity-arbiter.ts` (spec 140) and its satellites (147 journal, 148 timeline/surplus).
Not published on the docs site (`docs/planning/` is excluded in `mkdocs.yml`).

## 1. Problem statement

The arbiter is a reactive greedy controller. Every decision is taken on the
instantaneous EMA of the grid meter, with fixed hysteresis (`engageHoldS`,
`releaseHoldS`), a static priority list, and minOn/minOff guards. The single
adaptive element is `finishLearnerRun()`, which learns one scalar per load: the
trimmed median of its steady-state draw.

The gap is not "no AI", it is **no horizon**. The decision that matters is not
"is there surplus right now" but "will the surplus hold for `minOnS`". Today the
arbiter cannot ask that question, so it engages on a sunny gap and revokes four
minutes later, or stays idle through a stable afternoon because the margin is
tuned for a cloudy day.

Two secondary gaps follow from the same root:

- The learner models a load as a constant. A heat pump draws about 2 kW at
  start and about 700 W once at setpoint. Engage sizing and preemption both use
  a number that is wrong at the moment it matters most.
- The arbiter has no notion of _need_. A load either claims or does not. There
  is nowhere to say "the pool pump needs 6 hours a day, place them well".

## 2. Guardrails (non-negotiable)

1. **Prediction never gates.** A forecast biases thresholds and ordering. The
   reactive loop stays authoritative. An untrained model, a stale forecast or a
   missing weather plugin must fall back to exactly the current v1 behaviour.
2. **Everything predicted is journaled**, with its inputs and a confidence
   figure. The "why first" journal is the product differentiator; a decision no
   one can explain is a regression even if it saves kWh.
3. **No heavy ML runtime.** Sowel runs on a small VM or an SBC. Ridge
   regression, EWMA, quantiles, all in plain TypeScript. No ONNX, no torch, no
   Python sidecar.
4. **Cold start must work.** A fresh install has zero history. A physical model
   gives day one; learning only refines it.
5. **No implicit behaviour learning.** Priority order and user overrides stay
   explicit config. Learned patterns may produce a UI _suggestion_, never a
   silent change.

## 3. Phases

Phases 0 to 2 deliver value with no new data source. Phases 3 to 5 are the
predictive core. Phase 6 is the largest product jump and is optimisation, not
machine learning.

### Phase 0: baseline and instrumentation

Nothing can be claimed as an improvement without a before. Today we cannot even
state how often the arbiter short-cycles.

- Define the metrics: grants per day per load, grants revoked within
  `minOnS + releaseHoldS` (the "regret" metric), total time granted, kWh
  self-consumed on surplus, kWh exported while a claimable load sat idle.
- Compute them from `arbiter_decision_log` plus `arbiter_surplus_log`.
- Blocker to solve first: both tables keep **7 days**
  (`ARBITER_JOURNAL_RETENTION_DAYS`, `ARBITER_SURPLUS_RETENTION_DAYS`). Either
  extend retention for a decision subset, or mirror the daily aggregates into
  the `sowel-energy-daily` Influx bucket, which already keeps 10 years.
- Deliverable: a script under `scripts/energy/` printing the metrics over a
  date range, plus a small UI panel later if it proves useful.

Effort: small. Risk: none. **Do this first, it is also how every phase below
gets accepted or rejected.**

**Specified on 2026-08-23 as `specs/158-arbiter-metrics/`, instrumentation
only.** Phases 1 and 2 were drafted alongside it and deliberately split back
out: they change the control loop, and they should be measured on this instrumentation
before they are written.

### Phase 1: adaptive hysteresis

`engageHoldS` and the engage margin are constants, so they are mistuned most of
the time: too cautious on a clear day, too nervous on a broken-sky day.

- Maintain a rolling volatility estimate of the signed grid reading (variance
  or mean absolute delta over the last 15 to 30 minutes), next to `emaPowerW`.
- Scale `engageHoldS` and the effective margin between a floor and a ceiling
  derived from the configured value: stable sky engages almost immediately,
  broken sky waits longer and demands more headroom.
- Journal the scaling factor in the grant reason so the timeline explains a
  slow engage.
- Config: keep the existing settings as the _nominal_ value plus one new
  `energy.arbiter.adaptiveHysteresis` boolean, defaulting off for one release.

Effort: small, roughly a day. Risk: low, fully local to `runEvaluate()`.
Measured on the Phase 0 regret metric.

### Phase 2: richer load learning

`runSamples` already collects every sample of a run and throws all but the
median away.

- Learn a small profile per load instead of a scalar: startup transient (peak
  and its duration), steady-state median, and a run-duration distribution
  (p50/p90).
- Use the transient for engage sizing, so a grant that would trip the tolerance
  during the first two minutes is either delayed or explicitly accepted.
- Use the duration distribution in Phase 5 and Phase 6.
- Migration: `energy_profile.learned` gains fields; keep the old `watts` key so
  existing rows and the three-tier `effectiveWatts()` fallback keep working.

Effort: medium. Risk: low, additive to an existing structure.

### Phase 3: hourly irradiance in the weather plugin (prerequisite)

`sowel-plugin-weather-forecast` currently exposes daily aggregates only
(`jN_*` aliases, excluded from history by `history-writer.ts`). A PV forecast
needs hourly data.

- Add Open-Meteo `shortwave_radiation` (and `cloud_cover`) at hourly
  resolution, exposed as a forecast series rather than as flat bindings.
- Decide the shape: a series does not fit the existing per-alias binding model
  well. Probably a dedicated data category plus a small store, similar to
  `arbiter_surplus_log`.
- Plugin release plus registry SHA bump, per the mandatory workflow in
  `CLAUDE.md`.

Effort: medium, and it is the real first ticket of the predictive core. Risk:
moderate, it touches the plugin data model.

### Phase 4: PV production forecast, calibrated per installation

This is the one genuinely machine-learning piece, and it is honest ML: a
physical model provides the shape, and per-installation regression calibrates
orientation, shading, soiling and ageing.

- Features: forecast irradiance, solar elevation and azimuth (already computed
  by `sunlight-manager`), cloud cover, day of year, outdoor temperature.
- Target: measured production, from the `sowel-energy-hourly` bucket (2 years).
- Model: ridge regression or a small gradient-boosted set of stumps, fitted in
  TypeScript. Refit nightly, a few hundred rows, milliseconds.
- Output: an hourly expected-production curve for the next 6 to 24 hours, with
  a confidence interval that widens with forecast age and cloud variability.
- Cold start: ship the clear-sky physical estimate with wide bounds until
  enough history exists; expose `runs`-style provenance the way the load
  learner already does.

Effort: large. Risk: moderate. Fully inert until Phase 5 consumes it.

### Phase 5: predictive engage gate

Where the forecast finally touches the control loop.

- Before granting, ask: does the predicted surplus stay above this load's need
  for at least `minOnS`? If confidence is high and the answer is no, hold the
  grant and journal "waiting, surplus not expected to hold".
- Symmetrically, if a dip is predicted to be brief, damp a revoke instead of
  short-cycling the load.
- Strictly a bias: low confidence, stale forecast or no model means current
  behaviour, unchanged.
- Journal every predictive hold with the predicted curve summary and the
  confidence, so the timeline can explain an idle sunny minute.

Effort: medium. Risk: **this is the phase that can visibly degrade behaviour.**
It needs the Phase 0 instrumentation, a shadow run against production data, and
a config kill switch.

### Phase 6: daily planner

The largest product jump, and deterministic. Not ML, constrained optimisation.

- Extend `EnergyLoadProfile` with a need: `dailyEnergyTargetKWh` or
  `minRunHoursPerDay`, plus optional allowed windows and a deadline.
- Given the forecast surplus curve (Phase 4), each load's power profile
  (Phase 2) and the HP/HC windows already classified by `tariff-classifier.ts`,
  compute a day plan: which load runs in which window.
- Greedy over sorted marginal value first; a MILP only if the greedy proves
  insufficient. Explainability matters more than optimality here.
- The plan becomes an input to the arbiter (it shifts priority and permits
  engaging slightly ahead of surplus), never a direct order issuer. The claim
  and grant model stays as it is.
- UI: the plan is a visible artifact on the arbiter timeline, "here is what
  today is supposed to look like", compared against what happened.

Effort: large, and worth a full spec of its own. Risk: moderate, but the
failure mode is a bad plan rather than a bad control loop, because Phase 6
never bypasses the reactive layer.

### Phase 7: opportunistic, independent of the rest

- **Statistical divergence.** `DIVERGENCE_RATIO = 0.3` is a fixed threshold
  that produces false positives on variable loads. Phase 2 gives a per-load
  distribution; flag on standard deviations instead. Small, cheap.
- **Natural-language journal explanations.** Out of the control loop, opt-in,
  cloud key required. The journal is already structured "why first", so the
  input is nearly free. Answers "why did the pool pump stop at 14:00" and
  produces a weekly summary. Related to the buildyourecipe exploration.
- **Config assistant.** Suggest `energyProfile` values from observed history,
  as a UI proposal the user accepts or rejects.

## 4. Explicit non-goals

- **Learning the priority order from user overrides.** A controller whose
  priority drifts on its own is impossible to reason about, and explainability
  is the arbiter's main asset. At most, a UI suggestion.
- **An LLM inside the control loop.** Latency, non-determinism, cost, and the
  arbiter must run offline.
- **Sub-15-minute cloud nowcasting.** It needs sky imagery or satellite feeds.
  Phase 1 volatility adaptation captures most of the available benefit at a
  fraction of the cost.
- **A cloud training service.** Everything fits on the local instance; sending
  a household's consumption curve off-box is a privacy cost with no matching
  benefit.

## 5. Suggested order

```
Phase 0  instrumentation           <- start here, prerequisite to claiming anything
Phase 1  adaptive hysteresis       <- fast win, no new data
Phase 2  richer load learning      <- feeds 5 and 6
Phase 3  hourly irradiance         <- plugin work, unblocks the core
Phase 4  calibrated PV forecast    <- the ML piece, inert until 5
Phase 5  predictive engage gate    <- the risky one, needs 0 to measure it
Phase 6  daily planner             <- own spec, biggest product jump
Phase 7  anytime, independent
```

Phases 0 to 2 are worth doing even if the rest is never built.

## 6. Open questions

- Retention: extend SQLite retention for arbiter history, or mirror daily
  aggregates into Influx? Phase 0 has to settle this.
- Forecast series shape: a new data category, or a dedicated store outside the
  binding model? Phase 3 has to settle this.
- Does the planner belong in `src/energy/`, or is it a recipe? It arbitrates
  across loads, which argues for core, alongside the arbiter.
