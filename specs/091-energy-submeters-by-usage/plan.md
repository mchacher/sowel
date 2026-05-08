# Plan — Spec 091

## Implementation steps (in order)

1. **Migration `009_submeter_integrator_state.sql`** — new SQLite table.

2. **Types** — `src/shared/types.ts`:
   - `EnergyByUsageResponse`, `EnergyByUsagePoint`, `SubmeterSeries`.
   - Mirror in `ui/src/types.ts`.

3. **`SubmeterIntegrator`** — `src/energy/power-submeter-integrator.ts`:
   - Class with `init()` (load state from SQLite), `start()` (subscribe to event bus + start minute ticker), `stop()`.
   - Subscribes to `equipment.data.changed` filtered on alias=`power` and equipment.type=`energy_meter` whose backing device data has category `power` (i.e. no real `energy`).
   - Trapezoidal integration on event, persistence to SQLite per update.
   - Minute ticker: writes via `HistoryWriter.writeAligned`.
   - Unit-testable: inject clock + event bus + db + history-writer mock.

4. **`HistoryWriter`** — skip HP/HC sub-write when equipment is of type `energy_meter`.
   - Add `equipmentType?: EquipmentType` to the metadata cache (already populated when loading bindings).
   - In `recordEnergyHpHcSplit`, return early if `meta.equipmentType === "energy_meter"`.

5. **Wiring at boot** — `src/index.ts`: instantiate `SubmeterIntegrator` after `HistoryWriter` and `EquipmentManager`, call `.init().start()`.

6. **API** — `src/api/routes/energy.ts`:
   - Add `GET /api/v1/energy/by-usage` route.
   - Reuse `computeRange()`, `findEnergyEquipmentId()`.
   - Per submeter (filter `getAll().filter(eq => eq.type === "energy_meter")`), run a Flux query identical in shape to `queryEnergyPoints` but parameterized by submeter equipmentId.
   - Compute `other` series.
   - Color picker: deterministic palette function shared with UI (or just emitted in response).

7. **UI** — additive:
   - `ui/src/components/equipments/DeviceSelector.tsx`: extend `EQUIPMENT_TYPE_CATEGORIES.energy_meter` to `["energy", "power"]`.
   - `ui/src/components/equipments/bindingUtils.ts`: ensure `power` alias accepted for `energy_meter` (already).
   - `ui/src/api.ts`: `getEnergyByUsage(period, date)`.
   - `ui/src/components/energy/EnergyPage.tsx`: `viewMode` state, toggle, conditional data fetch & render.
   - `ui/src/components/energy/EnergyBarChart.tsx`: support an alternative `series[]` mode in addition to the existing fixed-key mode.
   - i18n strings.

8. **Tests** (see Test Plan).

9. **Validate**: backend `tsc --noEmit`, UI `tsc -b --noEmit`, `vitest run`, `eslint`.

10. **Commit, push, PR.**

## Test Plan

### Modules to test

- `power-submeter-integrator` — integration math + persistence + stale handling.
- `history-writer` — submeter writes do **not** generate HP/HC sub-points.
- `energy-by-usage` API route — query shape, "other" residual computation.

### Scenarios

| Module                    | Scenario                                                                      | Expected                                                              |
| ------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| power-submeter-integrator | First sample after boot                                                       | Sets `last_sample_*` only, cumulative stays 0                         |
| power-submeter-integrator | Second sample 60 s later, both at 1000 W                                      | cumulative_wh += 1000 \* 60 / 3600 ≈ 16.67                            |
| power-submeter-integrator | Trapezoid: prev=500 W, current=1500 W, Δt=60 s                                | cumulative_wh += (500+1500)/2 \* 60 / 3600 ≈ 16.67                    |
| power-submeter-integrator | Negative power (clamp wired backwards) → integrate abs                        | Cumulative goes up, not down. WARN logged once.                       |
| power-submeter-integrator | Stale sample (Δt > 600 s)                                                     | No integration; just refreshes `last_sample_*`.                       |
| power-submeter-integrator | Restart with persisted state                                                  | After init, `cumulative_wh` matches the SQLite row.                   |
| power-submeter-integrator | Minute ticker after no change                                                 | No write (dedup via `last_write_value_wh`).                           |
| power-submeter-integrator | Minute ticker after a change                                                  | `historyWriter.writeAligned` called once with the new cumulative.     |
| history-writer            | `category=energy, alias=energy, equipmentType=energy_meter`                   | No HP/HC sub-points written (only the main energy point).             |
| history-writer            | `category=energy, alias=energy, equipmentType=main_energy_meter` (regression) | HP/HC sub-points still written as before.                             |
| api energy-by-usage       | No submeter configured                                                        | `submeters` empty, `other` empty, totals zero.                        |
| api energy-by-usage       | Two submeters with data, total > sum                                          | `other.points[i].wh = total - Σ submeters` per timestamp; clamp at 0. |
| api energy-by-usage       | Submeter exists but no data in window                                         | Submeter present in response with empty points array.                 |

## Out of scope (explicit)

- No backfill of historical data prior to v1.5.7.
- No live (real-time) view extension.
- No stats or daily summaries per submeter beyond what the chart shows.
- No HP/HC tariff for submeters.
