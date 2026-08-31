# Spec 170 — Architecture

## Data model

One additive field on an existing public type. No SQLite change, no migration, nothing persisted: `ZoneAggregatedData` is derived on every aggregation pass.

```ts
// src/shared/types.ts — ZoneAggregatedData
/**
 * Spec 170 — live sum, in watts, of the consumption submeters in this zone and
 * its descendants. `null` when nothing current was found to sum, which is not
 * the same as a measured 0 W.
 */
powerTotal: number | null;
```

The internal accumulator follows the `waterFlow` pair exactly — a running sum plus a "did anything land here" flag, so the `null`/`0` distinction survives the merge:

```ts
// src/zones/zone-aggregator.ts — Accumulator
powerSum: number;
powerHasData: boolean;
```

## Where it plugs in

The aggregator already walks a zone and its descendants, merges accumulators, and turns the result into the public shape. Three existing seams, no new pass:

```
ZoneAggregator.aggregateZone(zoneId)
  → collect equipments of the zone + descendants
      → status === "offline"  → unavailableByCategory, skip        (unchanged, FR-5)
      → accumulateEquipmentPower(acc, withDetails)                 (NEW)
      → accumulateWaterValve / accumulateBindings                  (unchanged)
  → mergeAccumulators(children)   → powerSum += , powerHasData ||= (NEW, FR-2)
  → toPublic(acc)                 → powerTotal = hasData ? round : null (NEW, FR-3)
```

`accumulateEquipmentPower` runs at the equipment level, not inside `accumulateBindings`, because the decision needs the equipment's **type** and **status**, not just a binding — `isSubmeterEquipment` keys off the type, and `classifyPowerReading` needs the status. That is the same reason the `display` counters and `water_valve` sit at that level.

## Review follow-up (#866 review, merged as a second pass)

Three points found on review of the first implementation, and what was done about them:

**The `power` alias is not the only live power channel.** A Legrand NLPC meter has no `power`
binding at all: its live channel is `demand_5min`, which is why `pickLivePowerW` on the equipment
tiles falls back to it. Looking up `power` alone therefore did not read a stale value, it read
nothing, and the meter dropped out of the total while its own card kept printing live watts. The
accumulator now walks `LIVE_POWER_ALIASES` (`power`, then `demand_5min`) and passes the matching
budget through `powerBudgetFor`, the same rule the tiles ask (#839) — hoisted into
`shared/reading-freshness.ts` so there is still one implementation, not two.

**The freshness rule had no clock.** `powerTotal` drops a reading past its budget, but the
aggregator only recomputes when an equipment reports, and a clamp that went quiet reports nothing.
`equipment.status.changed` does not close the gap either: `equipment-status.ts` applies the
electrical window only to `METERING_EQUIPMENT_TYPES`, so a metering plug stays `online` however
old its watts are. In the case this spec is written for — a guest house whose zone holds two
meters and nothing else — the total would have stayed frozen indefinitely. A 60 s wallclock tick
now recomputes the chains of the zones that actually carry power readings; the cached
`powerHasData` flag is both the trigger and the stop condition.

**Rounding.** Tenths of a watt are never displayed (whole watts below the kilowatt, one decimal of
a kilowatt above), and they guarantee that sub-watt jitter on an idle plug flips
`aggregatedDataEqual` and emits `zone.data.changed` up the whole ancestor chain. The sum is now
rounded to whole watts, which also means the number the API and MQTT publish is the number the
pill shows.

## The two shared rules it reuses

Neither is restated:

| Question                        | Answered by                                             | Lives in                          |
| ------------------------------- | ------------------------------------------------------- | --------------------------------- |
| Is this equipment a load?       | `isSubmeterEquipment(type, bindings)` (#523, blocklist) | `src/equipments/metering.ts`      |
| Is this reading a live value?   | `classifyPowerReading({...}) === "current"` (#832)      | `src/shared/reading-freshness.ts` |
| Which budget does it answer to? | `powerBudgetFor(type, alias)` (#839)                    | `src/shared/reading-freshness.ts` |

`classifyPowerReading` already returns `offline` for an offline equipment, so the call is correct even though the early-out means it never sees one.

## Event flow

Unchanged. `powerTotal` rides the existing `zone.data.changed` event and the existing WebSocket push. The change-detection helper `aggregatedDataEqual` gains one comparison so a zone whose power moved actually emits:

```ts
a.powerTotal === b.powerTotal &&
```

Without that line the field would update silently and the UI would keep the previous value until some other field moved — the failure mode `aggregatedDataEqual` exists to prevent.

**Cadence note.** A power reading moves on every meter report (45 s on the reference PJ-1203A clamps, faster on some plugs), and each move now flips `aggregatedDataEqual` to false and emits `zone.data.changed`. That is the intended behaviour — it is what makes the pill live — and it is the same order of magnitude as temperature and humidity traffic, which already ride this path from every sensor in the house. High-frequency events are deduplicated per batch before reaching WebSocket clients.

## API

No new endpoint. `powerTotal` appears in every payload already carrying `aggregatedData`:

- `GET /api/v1/zones/:id/aggregation`
- the `zone.data.changed` WebSocket message

## UI

One pill, in the existing counter cluster of `ZoneAggregationPills.tsx`, rendered when `powerTotal !== null`:

```tsx
if (data.powerTotal !== null) {
  counterPills.push({
    key: "power",
    icon: <Zap size={14} strokeWidth={1.5} />,
    label: formatWatts(data.powerTotal),
    variant: data.powerTotal > 0 ? "active" : "default",
    ...
  });
}
```

`formatWatts` keeps watts below 1000 (`39 W`) and switches to kilowatts above (`2.4 kW`), so a house drawing four figures does not print six characters of noise. Unit symbols are not translated, like the `m³/h` suffix on the water-valve pill.

## Files touched

| File                                              | Change                                                          |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `src/shared/types.ts`                             | `powerTotal` on `ZoneAggregatedData`                            |
| `src/zones/zone-aggregator.ts`                    | accumulator pair, `accumulateEquipmentPower`, merge, public, eq |
| `src/zones/zone-aggregator.test.ts`               | the scenarios of the test plan                                  |
| `ui/src/types.ts`                                 | mirror `powerTotal`                                             |
| `ui/src/components/home/ZoneAggregationPills.tsx` | the power pill + `formatWatts`                                  |
| `docs/user/zones.md` / `.fr.md`                   | what the pill shows and what it deliberately excludes           |

## Rejected alternatives

**Sum inside `accumulateBindings`.** It receives bindings and an equipment type but no status, so freshness could not be judged there without widening the signature for one caller.

**A `power` field on the zone row in SQLite.** Persisting a derived, second-resolution value invites it to go stale and disagree with the equipments it comes from. Every other aggregate is derived; this one is not special.

**Reusing `energy_meter` as the only contributor.** It would miss metering plugs (`switch` + `power`), which are loads by exactly the same argument, and would introduce a second definition of "a load" alongside `isSubmeterEquipment`.
