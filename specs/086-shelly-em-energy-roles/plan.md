# Spec 086 — Implementation plan

## Tasks

### Step A — Sowel core (must ship first)

1. [ ] In `src/devices/device-manager.ts`, add a public method
       `getDeviceDataValue(integrationId: string, sourceDeviceId: string,
key: string): string | number | boolean | null` that re-uses
       `findDeviceDataByDeviceAndKey` and decodes the stored value
       according to the `type` column.
2. [ ] Add unit tests in `src/devices/device-manager.test.ts`: returns
       `null` for unknown device, unknown key, or null-valued key;
       returns the typed value when present.
3. [ ] Run `npx tsc --noEmit`, `npx vitest run`, `npx eslint src/ --ext
.ts` — all green.
4. [ ] Commit on branch `feat/086-energy-roles`, open a PR, wait for
       CI, merge after explicit user approval.
5. [ ] Release Sowel v1.5.1 via `scripts/release.sh 1.5.1` so the
       plugin can target it.

### Step B — Plugin `sowel-plugin-shelly-mqtt` v1.1.0

6. [ ] Extend the local `DeviceManager` interface in
       `src/shelly-plugin.ts` to include `getDeviceDataValue`.
7. [ ] Add `private lastCumul = new Map<string, { fwd?: number; rev?:
number }>()` to `ShellyEngine`.
8. [ ] On `start()`, after subscribing, hydrate `lastCumul` for every
       already-known channel (`this.known`) by reading
       `energy_forward` / `energy_reverse` from `device_data`. New
       channels discovered later populate `lastCumul` lazily inside
       `handleEm1DataStatus`.
9. [ ] Refactor `handleEm1DataStatus` to:
   1. Parse `parseEm1DataStatus` as today.
   2. Compute `deltaFwd = max(0, currentFwd − lastFwd)` and
      `deltaRev = max(0, currentRev − lastRev)`.
   3. `energy = deltaFwd − deltaRev` (signed Wh).
   4. Update `lastCumul.set(sid, { fwd: currentFwd, rev: currentRev })`.
   5. Build `data = { energy_forward, energy_reverse, energy }` and
      forward to `deviceManager.updateDeviceData(...)`.
10. [ ] Bump `manifest.json` (`version` to `1.1.0`, `sowelVersion` to
        `>=1.5.1`) and `package.json` (`version` to `1.1.0`).
11. [ ] Tests (see plan below).
12. [ ] Build, commit, tag `v1.1.0`, push.

### Step C — Sowel registry + operational

13. [ ] Update `plugins/registry.json` — `shelly_mqtt` version → `1.1.0`,
        `sowelVersion` → `>=1.5.1`. Commit on `main`. No Sowel release.
14. [ ] In production, update the plugin via UI Integrations.
15. [ ] Manual UI step (operational, not code): - Edit equipment `Shelly Grid` → add bindings for
        `energy_forward`, `energy_reverse`, `energy`. - Same for `Shelly Solar`. - Save → equipments emit `equipment.data.changed` for `energy`,
        the aggregator picks them up.

### Step E — Sowel core fixes uncovered by IT 086

Iteration 086 surfaces several latent bugs in the energy pipeline that
only become visible once the Shelly plugin starts emitting multiple
energy-category aliases on the same equipment. Bundled in the same PR.

19. [x] `EquipmentManager.addDataBinding` / `removeDataBinding` /
        `setHistorize` / `addOrderBinding` / `removeOrderBinding` —
        emit `equipment.updated` so the `HistoryWriter` cache (and
        every other listener with a similar binding-keyed cache)
        refreshes. Without this, freshly-added bindings are invisible
        to the writer until the equipment is otherwise modified — and
        the new `energy` binding on `Shelly Grid` / `Shelly Solar`
        would not be historized after the user saves it in the UI.
20. [x] `EnergyAggregator` Flux queries — add `r.alias == "energy"`
        to the filters. Without this, the cumul query iterates one
        result row per (alias, equipment) and overwrites
        `energyDayWh` / etc. with the _last_ alias seen — typically
        `energy_reverse` (cumulative counter), corrupting every cumul
        downstream. Also include the current hour from the raw bucket
        in the day cumul; the previous code only summed the hourly
        bucket, missing the in-flight hour.
21. [x] `HistoryWriter.ALIAS_DEFAULTS_OFF` — add `energy_forward` and
        `energy_reverse`. These are monotonic Shelly cumuls (hundreds
        of kWh) that pollute every category=energy aggregation. The
        plugin still emits them as latest values for the Live page;
        the historize default just stops them from being written as
        time-series points.

### Step F — Self-consumption writer (replaces Netatmo poller)

The previous Netatmo HC poller (decommissioned with IT 085) wrote
`autoconso` and `injection` aliases to the production equipment's
Influx tag. With Shelly providing only the raw counters, this split
needs to be derived in Sowel.

22. [x] New `src/energy/self-consumption-writer.ts` listens to
        `equipment.data.changed` events with `alias == "energy"`,
        keeps the latest signed delta for the Grid + Solar equipments,
        and on each new tick computes: - `injection = max(0, -gridΔ)` - `autoconso = max(0, solarΔ - injection)`
        and writes 2 points to InfluxDB (`autoconso` + `injection`)
        tagged with the production equipment's id, mirroring how
        `writeEnergyHpHc` handles the HP/HC split.
23. [x] Wire it into `src/index.ts` next to `historyWriter.init()`.
24. [x] 11 unit tests covering grid-importing / grid-exporting / no
        flow / restart / out-of-window / disabled Influx / no-solar.

### Step D — Validation

16. [ ] After 24 h of running, query the Sowel Consumption page and
        compare daily total to: - Legrand / Netatmo dashboard (`home.netatmo.com/control/dashboard`). - Shelly's own `total_act_energy` end-of-day minus start-of-day
        (visible in DeviceData via API).
17. [ ] Spot-check HP/HC totals against the configured tariff schedule.
18. [ ] Verify reset behaviour by restarting the Sowel container and
        confirming the next plugin event produces no spurious daily
        spike.

## Test plan

### Modules to test

- `src/devices/device-manager.ts` — new public getter
  `getDeviceDataValue`.
- `sowel-plugin-shelly-mqtt/src/shelly-plugin.ts` — energy delta
  synthesiser, restart hydration, reset detection.

### Scenarios

| Module        | Scenario                                                                | Expected                                                        |
| ------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| DeviceManager | `getDeviceDataValue` for an unknown device                              | returns `null`                                                  |
| DeviceManager | `getDeviceDataValue` for an unknown key on an existing device           | returns `null`                                                  |
| DeviceManager | `getDeviceDataValue` for a `number`-typed key                           | returns the numeric value                                       |
| DeviceManager | `getDeviceDataValue` for a `boolean`-typed key                          | returns the boolean value                                       |
| DeviceManager | `getDeviceDataValue` for a key whose value is null                      | returns `null`                                                  |
| ShellyEngine  | First em1data event for a new channel                                   | `energy = 0`, `lastCumul[sid]` populated with the current cumul |
| ShellyEngine  | Steady-state — fwd grows, rev unchanged                                 | `energy = +deltaFwd`                                            |
| ShellyEngine  | Steady-state — rev grows, fwd unchanged                                 | `energy = −deltaRev`                                            |
| ShellyEngine  | Both fwd and rev grow within the same window                            | `energy = deltaFwd − deltaRev`                                  |
| ShellyEngine  | Counter reset — current fwd < last fwd                                  | `energy = 0`, baseline updated to current                       |
| ShellyEngine  | Out-of-order — old `em1data` arrives after a newer one (current < last) | `energy = 0`, no negative emission                              |
| ShellyEngine  | Plugin restart — DeviceManager has previously persisted fwd/rev         | `lastCumul` hydrated; first delta uses persisted baseline       |
| ShellyEngine  | Plugin restart — DeviceManager has no prior data                        | First event treats current as baseline, `energy = 0`            |
| ShellyEngine  | em1data with only one of fwd/rev present (partial payload)              | Compute delta on the field that arrived; the other is unchanged |

### Notes

- Re-use the existing test scaffolding in
  `sowel-plugin-shelly-mqtt/src/shelly-parser.test.ts` (Vitest).
- For the engine tests, mock `DeviceManager` with a small in-memory
  Map<sid → key → value> and a stub `updateDeviceData` that captures
  arguments.
- No InfluxDB / Sowel core in the test loop — the plugin tests run in
  isolation against the pure functions and the engine.
- Sowel core has zero behaviour change in this iteration → no new tests
  on Sowel side.
