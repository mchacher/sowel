# Spec 132 — Per-phase power breakdown on Energy · Live

## Context

Companion to the `sowel-plugin-legrand-energy` NLY fix (three-phase Legrand
Drivia with Netatmo meters, ref. 412175 — see that repo's own spec). Once a
three-phase meter is discovered, its `main_energy_meter` equipment exposes an
aggregate `power`/`energy`, but nothing surfaces the per-phase instantaneous
power. Energy → Live today only renders the Grid/Solar/Maison flow diagram
and the by-usage donut (submeters of type `energy_meter`).

The user (Romain / alpitux) owns a real three-phase installation and wants to
see the load split across L1/L2/L3 (useful to spot an unbalanced phase),
directly in Sowel, without waiting for a historical view.

## Goal

Add an **optional** per-phase power breakdown panel to the Energy → Live page,
driven by a **convention**, not a new equipment type: a `main_energy_meter`
equipment may carry extra data-binding aliases `power_l1`, `power_l2`,
`power_l3`. Any plugin able to expose per-phase power can adopt it (not
Legrand-specific — e.g. a Shelly Pro 3EM's spare CT channel could use the
same aliases).

## Scope

### In scope

- New component `ui/src/components/energy/PhaseBreakdown.tsx`: one bar per
  detected phase (instantaneous power + proportion), rendered under the
  existing flow diagram on `LiveEnergyPage.tsx`.
- Renders **nothing** when fewer than 2 `power_l{n}` aliases are bound on any
  `main_energy_meter` equipment.
- FR/EN i18n: `energy.live.phases.title`, `energy.live.phases.phase`.
- Pure phase-extraction logic split into a testable helper module (mirrors
  the existing `submeter-helpers.ts` / `productionTotal.ts` pattern).

### Out of scope (explicitly excluded)

- **Historical (Consumption page) per-phase breakdown.** The Netatmo/Legrand
  `getMeasure` API only returns accumulated energy at the bridge
  (whole-installation) level — never per phase, only instantaneous `power`
  per phase via `homestatus`. A historical view would need a dedicated W→Wh
  accumulation pipeline for phases, separate from the existing by-usage
  submeter integrator (to avoid the residual-corruption issue below).
  Deferred to a future spec if requested.
- **Modeling phases as `energy_meter`-type equipments.** That type feeds the
  by-usage donut (`Autre = Total − Σ submeters`, spec 091). Phases sum to
  ~100% of the total rather than being a usage subset (PAC, Piscine, ...);
  reusing that type would collapse "Autre" to ~0 and misrepresent phases as
  usage categories. This was tried, the corruption risk caught before
  shipping, and rejected in favor of the alias convention above.
- Any change to `EquipmentType`, the DB schema, or the by-usage
  (`/api/v1/energy/by-usage`) / history (`/api/v1/energy/history`) routes.

## Acceptance criteria

- [x] AC1 — On Energy → Live, a "Répartition par phase" / "Phase breakdown"
      panel appears under the flow diagram when a `main_energy_meter`
      equipment has ≥ 2 `power_l{n}` data bindings.
- [x] AC2 — Each phase renders its instantaneous power and its proportion of
      the largest phase (bar width).
- [x] AC3 — The panel renders nothing (`null`) when 0 or 1 `power_l{n}`
      aliases are bound — **zero visual change for single-phase installs**.
- [x] AC4 — No change to the by-usage donut (`LiveSubmeterBreakdown`) or to
      `/api/v1/energy/by-usage` behavior.
- [x] AC5 — Works end to end against a real three-phase meter: values shown
      match what the bound devices report (sanity: Σ phases ≈ Total).

## Edge cases

| Case                                              | Expected                                    |
| -------------------------------------------------- | -------------------------------------------- |
| No `power_l{n}` alias bound anywhere                | Panel absent (existing single-phase installs) |
| Exactly 1 `power_l{n}` alias bound                  | Panel absent (need ≥ 2 to be meaningful)      |
| 2 or 3 `power_l{n}` aliases bound, all numeric       | Panel renders one bar per phase               |
| A bound phase value is `null` / non-number           | That phase excluded from the extracted set    |
| Multiple `main_energy_meter` equipments              | Phase powers summed per phase number across them |
| Phase power is 0 W                                   | Bar renders at 0 width, value still shown     |
