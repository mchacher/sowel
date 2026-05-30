# Plan — Spec 118

## Phasing

The work splits naturally into two PRs so each can ship independently.

### PR-A — UI + history backend (F1 + F2 + F5 + F6 + F7 + F8)

1. `src/history/history-query.ts` (F8): fix the cumulative branch so the downsampled bucket query reads `_field == "mean"` instead of `_field == "value_number"`. Add a unit / integration test that reads `sum_rain_24` from a seeded `sowel-daily` bucket and asserts the values come back. Quick to verify on sowelox right after the patch ships.
2. `src/history/history-writer.ts` (F6): add `wind_angle`, `gust_strength`, `gust_angle` to `ALIAS_DEFAULTS_OFF`. No new test needed (the alias-OFF code path already has coverage).
3. `ui/src/components/history/history-utils.ts`:
   - Add `ChartFamily` type + `familyOf(category)` helper. Add 1 unit test per family (3 tests).
   - Add `ENVELOPE_CATEGORIES` set + `hasEnvelope(category)` helper. Add 2 unit tests (one positive, one negative).
   - Add `BOOLEAN_CATEGORIES` set + `isBooleanCategory(category)` helper. Add 2 unit tests.
   - Add `booleanTickLabels(category)` returning the i18n key pair. Add 1 unit test per supported category.
   - Rewrite `isCumulativeChart(categories: string[])` as a one-liner over `familyOf`. Keep the existing `isCumulativeBarChart(category)` signature for backward compat with HistoryPanel.
4. i18n: add `analyse.envelopeToggle`, `analyse.familyLocked` ("Famille : {family}"), `analyse.clearChart` ("Vider le graphe"), `analyse.familyIncompatible` ("Famille incompatible — supprimez les séries actuelles pour mélanger"), and the boolean tick labels (`analyse.bool.motion.{on,off}`, `analyse.bool.contact.{open,closed}`, `analyse.bool.leak.{dry,wet}`, `analyse.bool.smoke.{clear,detected}`) in FR and EN.
5. `AnalyseView.tsx`:
   - Add `const [envelopeOn, setEnvelopeOn] = useState(true)`.
   - Derive `lockedFamily = useMemo(() => seriesList[0] ? familyOf(seriesList[0].category) : null, [seriesList])`.
   - Extend `chartData` rows with `${s.id}:min` and `${s.id}:max` keys when the point carries `min` / `max` (history API already returns them at 1h / 1d resolution).
   - Chart selection (single switch on `lockedFamily`):
     - `cumulative` → `<BarChart>`.
     - `states` → `<LineChart>` with `type="stepAfter"` and a `[0, 1]` Y axis using `booleanTickLabels` for tick formatting.
     - `measurements` (default) → `<LineChart>` with the `<Area>` envelope for series whose category is in `ENVELOPE_CATEGORIES`, gated by `envelopeOn && resolution !== "raw"`.
     - `null` (no series) → empty-chart placeholder unchanged.
   - Tooltip formatter:
     - For Measurement rows with `:min` / `:max` companion keys: `21.5 °C (18 / 26)`.
     - For State rows: replace the raw `0` / `1` with the semantic label via `booleanTickLabels`.
   - Picker enhancements: disable bindings whose `familyOf(b.category) !== lockedFamily` when `lockedFamily !== null`; render a tooltip with `analyse.familyIncompatible` on the disabled rows.
   - Add the toggle button "Enveloppe min/max" next to the PeriodSelector (only visible when `lockedFamily === "measurements"` AND the active resolution is `1h` or `1d` AND at least one series is in `ENVELOPE_CATEGORIES`).
   - Add a "Vider le graphe" button next to the family-lock indicator, visible only when `lockedFamily !== null`.
6. Manual visual check on the dev server (sowelox running v1.15.7 with the bus already populated):
   - Année view, temperature series → band visible.
   - Toggle off → band disappears.
   - Jour view → no band.
   - Rain-only chart → bars.
   - Add a temperature series to a chart that already has a temperature series → picker enables only Measurement bindings.
   - Add a rain binding while a temperature series is active → rain row appears disabled with the tooltip.
   - "Vider le graphe" → picker reopens unlocked.
   - Contact-only chart, Jour view → step line with `fermé` / `ouvert` ticks.
   - Wind direction / gust strength / gust angle → not listed in the picker on a fresh install.

### PR-B — Plugin backfill (F3 + F4)

Already implemented on `sowel-plugin-netatmo-weather#1`. PR-B in this repo is just:

1. Update `scripts/README.md` in the plugin repo (already present? double-check) with a section for `--only=<filter>` and the `sum_rain_24` daily-total semantics.
2. After Sowel core PR-A is merged, schedule a one-time `--only=rain` re-run on every Sowel install that suffered the data-loss to repopulate `sum_rain_24`. Document this once-off recovery in the release notes.

## Test Plan

### Modules to test

- `history-utils.ts` — new helpers `isCumulativeChart`, `isBooleanCategory`, `booleanTickLabels`.
- `history-query.ts` — F8 cumulative-downsampled fix: seed `sowel-daily` with a `sum_rain_24` point and assert `handleHistoryQuery` returns it on a 1d resolution.
- `AnalyseView.tsx` — visual integration (no unit test on the React component; manual verification per the checklist below).
- `backfill-history.ts` (plugin) — already tested by the sowelox run; record the outcome here for traceability.

### Scenarios per module

| Module                               | Scenario                                            | Expected                                                                                                       |
| ------------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `isCumulativeChart`                  | empty array                                         | false (no series → no special mode)                                                                            |
| `isCumulativeChart`                  | `["rain"]`                                          | true                                                                                                           |
| `isCumulativeChart`                  | `["rain", "energy"]`                                | true                                                                                                           |
| `isCumulativeChart`                  | `["rain", "temperature"]`                           | false                                                                                                          |
| `familyOf`                           | `"temperature"`                                     | `"measurements"`                                                                                               |
| `familyOf`                           | `"rain"`                                            | `"cumulative"`                                                                                                 |
| `familyOf`                           | `"motion"`                                          | `"states"`                                                                                                     |
| `familyOf`                           | `"unknown_category"`                                | `null`                                                                                                         |
| `hasEnvelope`                        | `"temperature"`                                     | true                                                                                                           |
| `hasEnvelope`                        | `"wind"`                                            | false                                                                                                          |
| `isBooleanCategory`                  | `"motion"`                                          | true                                                                                                           |
| `isBooleanCategory`                  | `"contact_door"`                                    | true                                                                                                           |
| `isBooleanCategory`                  | `"temperature"`                                     | false                                                                                                          |
| `booleanTickLabels`                  | `"contact_door"`                                    | i18n keys for `["fermé", "ouvert"]`                                                                            |
| `booleanTickLabels`                  | `"motion"`                                          | i18n keys for `["absent", "présent"]`                                                                          |
| `AnalyseView` (manual)               | Année + 1 temperature series + envelope on          | line + band; tooltip 3-tuple                                                                                   |
| `AnalyseView` (manual)               | Année + envelope off                                | line only                                                                                                      |
| `AnalyseView` (manual)               | Jour + 1 series                                     | line only, no band (raw resolution)                                                                            |
| `AnalyseView` (manual)               | Mois + rain only                                    | bar chart, one bar per day                                                                                     |
| `AnalyseView` (manual)               | Picker after adding a temperature series            | Rain / motion / contact rows appear disabled with the "Famille incompatible" tooltip                           |
| `AnalyseView` (manual)               | Picker after clicking "Vider le graphe"             | Every binding re-enabled; family-lock indicator gone                                                           |
| `AnalyseView` (manual)               | Jour + 1 `contact_door` series                      | step line on `[0, 1]` Y axis with `fermé` / `ouvert` ticks                                                     |
| `AnalyseView` (manual)               | All boolean series (e.g. `contact_door` + `motion`) | single LineChart with `[0, 1]` axis shared by both step lines; tooltip surfaces each series' own labels        |
| `AnalyseView` (manual)               | Wind / gust bindings on a fresh install             | Not listed in the picker (filtered out by `effectiveOn=false`)                                                 |
| backfill `--only=rain`               | 30-day re-run on sowelox                            | `sum_rain_24` daily bucket has ~30 points, each = sum of that day's 30-min Rain values                         |
| backfill `--only=rain` (idempotency) | Re-run same command                                 | No duplicates, only the rain + sum_rain_24 aliases touched, other aliases (temperature, humidity, …) untouched |

### Retro-compat

- Saved charts without `min` / `max` in their payload (older legacy data on installs still running on the live writer alone, no backfill) → the Area band has nothing to render and `connectNulls` keeps the line intact. No crash.
- Mixed-period chart with one series in raw resolution and another aggregated → the band is gated by the active period (one resolution per chart, the existing `aggregation: "auto"` already enforces this).

## Local InfluxDB replication from production (dev test fixture)

To validate F1, F2, F5, F8 against realistic data without poking sowelox repeatedly, mirror the production Influx into a local dev instance once and reuse it across the iterations.

**Source of truth identification** (apply [[feedback-identify-base-explicitly]] verbatim):

| Side      | Where                                            | Container / host                                                                                            | Org     | Token source                                                                           |
| --------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------- |
| Prod      | sowelox (192.168.0.230)                          | `sowel-influxdb` on the `sowel_default` Docker network                                                      | `sowel` | `DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=sowel-auto-token` (from container env)               |
| Local dev | macOS workstation, `docker compose` in this repo | container name varies per `docker-compose.yml` (do not assume `sowel-influxdb` locally — `docker ps` first) | `sowel` | Inspect the container env or `settings.history.influx.token` of the local Sowel SQLite |

**Replication command** (one-shot, runs from the local host):

```bash
# 1. Backup from prod (writes to /tmp on sowelox host)
ssh mchacher@192.168.0.230 'docker exec sowel-influxdb influx backup /tmp/influx-prod-backup --token sowel-auto-token --org sowel'
ssh mchacher@192.168.0.230 'docker cp sowel-influxdb:/tmp/influx-prod-backup /tmp/influx-prod-backup'
scp -r mchacher@192.168.0.230:/tmp/influx-prod-backup /tmp/influx-prod-backup-local

# 2. Restore into local dev (DESTRUCTIVE — confirms target every time)
LOCAL_INFLUX_CT=$(docker ps --format '{{.Names}}' | grep -i influx | head -1)
echo "Restoring INTO local container: $LOCAL_INFLUX_CT (NOT prod, NOT sowelox)"
docker cp /tmp/influx-prod-backup-local "$LOCAL_INFLUX_CT:/tmp/restore"
docker exec "$LOCAL_INFLUX_CT" influx restore /tmp/restore --full --token <local-admin-token>
```

**Guardrails** (mandatory before each run):

- Echo the source host (`sowelox / 192.168.0.230`) and the target container (`$LOCAL_INFLUX_CT`) before the `influx restore` call. If they look identical, abort.
- Never run `influx restore` against `sowel-influxdb` on sowelox. The `--full` flag wipes the target buckets — running it on prod would delete all historized data, including the rain backfill we just recovered.
- Refresh the snapshot at most once per session — replication takes ~2-5 min for 365 days of weather + energy.
- Local Sowel core reads from the restored buckets transparently; no settings change needed beyond pointing `INFLUX_URL` / `INFLUX_TOKEN` at the local instance.

**Used by**:

- F8 test: query `sum_rain_24` on the restored `sowel-daily` and assert non-zero days appear (e.g. 2026-05-04 ≈ 5.26 mm based on prod snapshot of 2026-05-30).
- F1 envelope visual: any temperature series on the restored data shows the historical min/max band on Année view.
- F2 bar mode visual: `rain` on Mois view renders as bars with the real precipitation pattern.

## Implementation order

Strictly:

1. Helper + tests in `history-utils.ts`.
2. i18n strings.
3. `AnalyseView` refactor — wire the envelope state, the bar-chart conditional, the tooltip.
4. Manual visual check on sowelox with current data.
5. Branch + commit + PR.

Plugin PR-B is already on its branch; merge once Sowel core PR-A lands.

## Estimated effort

- PR-A (Sowel UI + history-writer): ~250-350 LOC with F5 + F6 + F7. The family-lock simplifies chart routing (single switch on `lockedFamily`, no ComposedChart), so the cost is roughly the same as the earlier "ComposedChart + mixed-selection" design. 3-4h with the manual visual passes.
- PR-B (plugin): trivial doc update, already coded.

## Not in this spec

- A configurable per-series toggle for the envelope.
- Persisting the envelope toggle in `SavedChartConfig`.
- Server-side daily-sum task for rain (would supersede F3 but is a larger backend change).
- Hybrid line+bar composed chart for mixed-category selections (rain bars + temperature line on the same chart).
- Dedicated rose-of-winds visual for `wind` (gust, angle).
- Heatmap rendering for boolean series at aggregated resolutions (the step line at `1d` shows the mean share-of-time, which is already informative).
- Logarithmic Y axis for `luminosity` (out of scope; default linear axis for the first iteration).
