# Implementation Plan — Spec 142

## Slices

### Slice A — The grouping helper

- A.1 — Add `ZoneGroup<T>` and `groupEquipmentsByZone()` to
  `ui/src/lib/zone-path.ts`: bucket by `zoneId`, emit in `ZoneOption` order,
  skip empty zones, trailing `zone: null` group for orphans.
- A.2 — Extend `ui/src/lib/zone-path.test.ts` with the scenarios below, on the
  spec 139 fixture tree (three `Salle de bain`, two `WC`).

### Slice B — The page (the reported bug)

- B.1 — `EquipmentsPage`: replace the local `groupByZone()` with
  `flattenZonesWithPath` (memoised on the tree) + `groupEquipmentsByZone`.
- B.2 — Extract `ZoneHeading`: ancestors in `font-normal text-text-tertiary`
  followed by the separator, the zone's own name keeping the existing heading
  weight; `t("dashboard.unknownZone")` when the chain is absent.
- B.3 — Key the group `<div>` on the zone id, not the heading text.
- B.4 — Delete the dead `ZoneWithChildren` import and the hardcoded
  `"Unknown zone"` string.

### Slice C — Validation & docs

- C.1 — `npm run validate` (backend + UI typecheck, lint, tests).
- C.2 — Manual check against a tree with homonymous rooms at different depths.
- C.3 — Specs index entry; no user-doc page describes this list, so `docs/`
  needs nothing else. Release notes at release time.

## Test Plan

### Modules to test

`ui/src/lib/zone-path.ts` — `groupEquipmentsByZone` is the whole behaviour; the
page component is a renderer over its output.

### Scenarios

| Scenario                                | Expected                                            |
| --------------------------------------- | --------------------------------------------------- |
| Three homonym zones, one equipment each | Three groups, one equipment each — the reported bug |
| Equipments in tree-scattered zones      | Groups in depth-first order, not alphabetical       |
| A group's zone                          | Carries the full `chain` to the renderer            |
| Zones without equipment                 | No group emitted                                    |
| Several equipments in one zone          | One group, input order preserved                    |
| Equipment pointing at a deleted zone    | Trailing `zone: null` group, equipment not dropped  |
| No equipments                           | No group                                            |

### Not covered by tests

The heading's visual hierarchy (muted ancestors vs emphasised name) and the
wrapping of a deep path on a narrow viewport. Checked with Playwright against a
live instance instead, desktop and 390 px — that pass is what caught the name
breaking mid-word on mobile and produced the `whitespace-nowrap` fix.
Screenshots in `screenshots/`.
