# Implementation Plan — Spec 139

## Slices

### Slice A — The helper

- A.1 — Create `ui/src/lib/zone-path.ts`: `ZoneOption`, `ZONE_PATH_SEPARATOR`,
  `flattenZonesWithPath()`, `zoneChainMap()`, `equipmentLabelMap()`.
- A.2 — Create `ui/src/lib/zone-path.test.ts` covering the scenarios below.

### Slice B — Recipe pickers (the reported bug)

- B.1 — Replace the three `allZones` flattenings with `flattenZonesWithPath`,
  widening `SingleEquipmentZonePicker` / `EquipmentListPicker` `zones` props to
  `ZoneOption[]`.
- B.2 — Render `path` in both zone dropdowns, in the duplicate-instance target
  zone dropdown, and in the selected-equipment chip.
- B.3 — Replace the five bare equipment `<option>` loops with a shared
  `EquipmentOptions`, and the two duplicated checkbox lists with a shared
  `EquipmentCheckboxList`, both qualifying only the names that repeat.
- B.4 — Fall back to the bare name when an equipment's zone is absent from the
  map.

### Slice C — Shared adoption

- C.1 — `AnalyseView`: delete the local `flattenZones()`, use the helper, keep
  `depth` driving indentation.

### Slice D — Validation & docs

- D.1 — Typecheck, lint, tests (backend + UI).
- D.2 — Manual check against a tree with homonymous rooms.
- D.3 — Mark acceptance criteria in `spec.md`; no user-doc page describes the
  picker labels, so `docs/` needs no change beyond the specs index entry at
  release time.

## Test Plan

### Modules to test

- `ui/src/lib/zone-path.ts` — the only new business logic. The components are
  presentation, and this project has no React component tests (CLAUDE.md).

### Scenarios

| Module    | Scenario                                             | Expected                                                                   |
| --------- | ---------------------------------------------------- | -------------------------------------------------------------------------- |
| zone-path | Unique zone name                                     | Label is the bare name — no ancestor noise                                 |
| zone-path | Homonymous leaves, one ancestor is enough            | `Maison › Salle de bain` / `RDC › Salle de bain` / `Étage › Salle de bain` |
| zone-path | Homonyms in a name group                             | Same segment count for the group, all labels distinct                      |
| zone-path | One ancestor not enough                              | Walks up: `Maison › RDC › Salle de bain` vs `Gîte › RDC › Salle de bain`   |
| zone-path | Homonyms no suffix separates                         | Falls back to the whole chain, no infinite loop                            |
| zone-path | Single root                                          | Dropped from descendants; the root's own label stays its name              |
| zone-path | Several roots                                        | Every chain complete, starting at its own root                             |
| zone-path | Depth reported                                       | 0 for a root, incremented per level, unaffected by the root omission       |
| zone-path | Order                                                | Depth-first, tree order preserved                                          |
| zone-path | Empty tree                                           | `[]`                                                                       |
| zone-path | Zone name containing the separator                   | Rendered verbatim, no escaping                                             |
| zone-path | `zoneChainMap` over the flattened list               | `Map` keyed by zone id, chains as arrays; `undefined` for an unknown id    |
| zone-path | `equipmentLabelMap`, unique name                     | Bare name                                                                  |
| zone-path | `equipmentLabelMap`, repeated name, distinct rooms   | `VMC — Salle de bain` / `VMC — Étage` — one segment is enough              |
| zone-path | `equipmentLabelMap`, repeated name, homonymous rooms | Walks up: `Température — Maison › Salle de bain`                           |
| zone-path | `equipmentLabelMap`, zone deleted                    | Bare name rather than `name — undefined`                                   |
| zone-path | `equipmentLabelMap`, same name and same zone         | Identical labels — only a rename can separate them                         |

### Manual verification

1. Tree with `Maison › Salle de bain`, `Gîte › RDC › Salle de bain`,
   `Gîte › Étage › Salle de bain`, each with a `Température` sensor.
2. Add a recipe with a single-equipment slot and one with an equipment list:
   both zone dropdowns and both equipment renderers name the right room.
3. Duplicate an instance to another zone: the target dropdown is unambiguous.
4. Switch to English and back: nothing in the label depends on the locale.
5. Captured in `screenshots/` against a live installation with three
   `Salle de bain`, two `WC` and three `VMC`.
