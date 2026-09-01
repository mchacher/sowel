# Architecture — Spec 173

## Data model

```sql
-- migrations/030_metering_parent.sql
ALTER TABLE equipments ADD COLUMN metering_parent_id TEXT
  REFERENCES equipments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_equipments_metering_parent ON equipments(metering_parent_id);
```

One nullable self-reference. `ADD COLUMN` with a `REFERENCES` clause is legal in SQLite as long as the
default is NULL, which it is — no table rebuild, unlike migration 029.

`Equipment.meteringParentId?: string | null` in `src/shared/types.ts`, mirrored in `ui/src/types.ts`,
carried by `rowToEquipment` and by the `updateEquipment` statement beside `energy_profile`.

## The arithmetic

```
ui slice(parent) = raw(parent) − Σ raw(direct children)     clamped at 0, per bucket
other            = main − Σ slices
```

Direct children only, which is what makes a chain work without recursion: for A ⊃ B ⊃ C,
`A−B` + `B−C` + `C` = A. Subtracting all descendants instead would remove C twice.

`src/energy/metering-nesting.ts` holds both pure pieces, testable without a database:

```
export function childrenByParent(equipments): Map<parentId, childId[]>
export function subtractChildren(series: Map<id, Point[]>, children: Map<id, id[]>): Map<id, Point[]>
export function wouldCycle(equipments, childId, parentId): boolean
```

`by-usage` calls `subtractChildren` on the raw series it already builds, before it sums them into
`sumPerTime` — so the residual and the per-equipment totals both follow from one change. The series
that lost something carries `netOfChildren: true` in the payload.

## Validation

`PUT /api/v1/equipments/:id` accepts `meteringParentId: string | null`:

| Refusal                                                                   | Code                            |
| ------------------------------------------------------------------------- | ------------------------------- |
| Parent id unknown                                                         | 404                             |
| Parent is the equipment itself                                            | 400 `MeteringParentSelf`        |
| The declaration closes a cycle                                            | 400 `MeteringParentCycle`       |
| Parent is `main_energy_meter`, `energy_production_meter` or `solar_panel` | 400 `MeteringParentNotSubmeter` |

`wouldCycle` walks the parent chain from the proposed parent; the check is on the resulting graph,
not on the pair, so A→B→C→A is caught at the last edge.

## What deliberately does not change

`EnergyAggregator`'s per-equipment cumuls, the equipment card, the history API and the zone
aggregation all keep the raw measurement. A meter reads what it reads; the subtraction is a property
of the _partition_, and a card that contradicted its own sensor would be a worse bug than the one
this spec fixes. The by-usage legend carries the "net" mention so the two readings are explainable.

## UI

- `MeteringParentPanel` (admin, submeter-eligible equipments only), under the electrical-metering
  panel on the equipment page: a select of the other eligible meters, plus "not included anywhere".
  Descendants are filtered out of the list, so the UI cannot even offer a cycle.
- `EnergyByUsageChart`: a slice flagged `netOfChildren` gets a "net of its submeters" mention in its
  legend tooltip.

## Files

| File                                                              | Change                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------ |
| `migrations/030_metering_parent.sql`                              | new — the column and its index                               |
| `src/shared/types.ts`                                             | `Equipment.meteringParentId`, `SubmeterSeries.netOfChildren` |
| `src/energy/metering-nesting.ts`                                  | new — the three pure functions                               |
| `src/equipments/equipment-manager.ts`                             | mapper, update statement, input type                         |
| `src/api/routes/equipments.ts`                                    | accept and validate the field                                |
| `src/api/routes/energy.ts`                                        | subtract before summing; flag the net series                 |
| `ui/src/types.ts`, `ui/src/api/equipments.ts`                     | the field                                                    |
| `ui/src/components/equipments/MeteringParentPanel.tsx`            | new — the admin control                                      |
| `ui/src/pages/EquipmentDetailPage.tsx`                            | mount it                                                     |
| `ui/src/components/energy/EnergyByUsageChart.tsx`                 | the "net" mention                                            |
| `ui/src/i18n/locales/{en,fr}.json`                                | panel + mention                                              |
| `docs/user/energy{,.fr}.md`, `docs/technical/data-model{,.fr}.md` | document it                                                  |
