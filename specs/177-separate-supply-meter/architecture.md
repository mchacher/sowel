# Spec 177 — Architecture

## Data model

**Migration `033_separate_supply.sql`**

```sql
ALTER TABLE equipments ADD COLUMN separate_supply INTEGER NOT NULL DEFAULT 0;
```

**`src/shared/types.ts`** — `Equipment` gains:

```ts
/** Spec 177 — this meter is fed by a separate supply: its consumption never
 *  flows through the main meter, so no reconciliation may count it. */
separateSupply?: boolean;
```

Mirrored in `ui/src/types.ts`.

## Backend

### `src/equipments/equipment-manager.ts`

- `rowToEquipment`: map `separate_supply` → `separateSupply` (boolean).
- `update()`: accept `separateSupply` alongside `meteringParentId`, same
  undefined-preserves-existing convention.

### `src/api/routes/equipments.ts` (PUT)

- Body schema: `separateSupply: { type: "boolean" }`.
- Validation (FR-4):
  - `separateSupply === true` on a `NON_SUBMETER_TYPES` equipment → 400.
  - Extend the spec 173 eligible-parent check: a parent with
    `separateSupply === true` is not an eligible `meteringParentId` target
    → 400.

### `src/api/routes/energy.ts` (by-usage)

Split the enrolment (FR-2/FR-3):

```ts
const enrolled = equipmentManager.getAll().filter(/* #523 as today */);
const submeterEquipments = enrolled.filter((eq) => !eq.separateSupply);
const separateEquipments = enrolled.filter((eq) => eq.separateSupply);
```

- Partition arithmetic (raw series, spec 173 subtraction, Σ, `other`, blended
  cost) runs on `submeterEquipments` only — untouched code path.
- `separateEquipments` get their raw series through the same
  `querySubmeterPoints` helper, zero-filled to the canonical bucket list
  (spec 119), **no** `childrenByParent`/`subtractChildren`, **no** cost.
- Payload: `EnergyByUsageResponse.separateSupply?: SubmeterSeries[]` (omitted
  when empty; `cost` fixed at 0, `netOfChildren` never set). Colors continue
  the same palette after the partition slices so no two series collide.

No other backend surface changes: `energy-aggregator`, `history-writer`,
`power-submeter-integrator` (which already integrates per-equipment without
reconciling), zone-aggregator (spec 170, out of scope) all keep writing and
reading the same series.

## UI

### `ui/src/lib/metering.ts`

No change to `isSubmeterEquipment` (the equipment IS a submeter — it is just
not reconciled). Consumers split on `eq.separateSupply`.

### `ui/src/components/energy/LiveSubmeterBreakdown.tsx` (+ `submeter-helpers.ts`)

- Row building unchanged (`readSubmeterReading` applies as-is — freshness,
  absolute value, status).
- Donut + `other` residual computed from non-separate rows only.
- Separate-supply rows rendered under the reconciled list in their own group
  with the `energy.byUsage.separateSupply` heading; power shown, no share of
  the donut, no percentage.

### `ui/src/components/energy/EnergyByUsageChart.tsx` (and its page wiring)

- Stacked chart and legend: partition slices only (payload `submeters` — no
  change needed, the backend already excludes).
- New group below the legend for `response.separateSupply`: name + kWh for the
  period, flagged "own supply", no €.

### `ui/src/components/equipments/MeteringParentPanel.tsx`

- Add the `separateSupply` toggle in the same metering section (admin only),
  with the explanation line; disable/hide the parent selector while the flag
  is on (FR-5: stored but unused) and exclude separate-supply meters from the
  eligible-parents list it offers.

### i18n

`en.json` / `fr.json`: group heading, toggle label + help text, by-usage hint.
FR: « Alimenté par un autre compteur » / group « Sur alimentation séparée ».

## Event flow

None new. The flag travels with the equipment object through the existing
`equipment.updated` WebSocket broadcast; both breakdown surfaces re-render from
their stores as with any equipment edit.

## API contract changes

| Surface                        | Change                                                         |
| ------------------------------ | -------------------------------------------------------------- |
| `PUT /api/v1/equipments/:id`   | accepts `separateSupply: boolean`; new 400s per FR-4           |
| `GET /api/v1/energy/by-usage`  | new optional `separateSupply: SubmeterSeries[]` in the payload |
| Equipment payloads (REST + WS) | carry `separateSupply`                                         |
