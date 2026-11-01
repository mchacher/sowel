# Implementation Plan — Spec 190

## Slices

### Slice A — Core

- [x] A.1 — `door` in the type unions, `VALID_EQUIPMENT_TYPES`, `CANDIDATE_BASED_TYPES` and the
      shutter candidate branch
- [x] A.2 — `src/shared/door-state.ts`
- [x] A.3 — `src/shared/equipment-type-change.ts`, `type` declared in the update schema
- [x] A.4 — zone aggregation `doorsOpen` / `doorsTotal`

### Slice B — UI

- [x] B.1 — bindings, form option, type meta, i18n
- [x] B.2 — controls: `useEquipmentState`, `ShutterControl`, tiles, sheet, widget icons
- [x] B.3 — zone group, pill, publisher source
- [x] B.4 — edit form type selector for the cover family

### Slice C — Docs

- [x] C.1 — the docs delta, EN and FR

## Test Plan

| Module                | Scenario                                   | Expected                               |
| --------------------- | ------------------------------------------ | -------------------------------------- |
| door-state            | `state` = `CLOSED` / `closed`              | closed                                 |
| door-state            | `OPEN`, `OPENING`, `CLOSING`, `FAULT`      | open, moving, moving, fault            |
| door-state            | unknown word, position 40                  | the position decides: open             |
| door-state            | no state, position 0 / 100                 | closed / open                          |
| door-state            | nothing bound                              | unknown                                |
| door-state            | count rule                                 | open, moving, fault count; unknown not |
| equipment-type-change | shutter, awning or door                    | the three cover types offered          |
| equipment-type-change | light_onoff, gate, pool_cover              | only the current type                  |
| equipment-manager     | update shutter → door                      | type changed, id and bindings kept     |
| equipment-manager     | update with the current type               | succeeds                               |
| equipment-manager     | existing specs 081 / 183 type-change tests | still pass (API not narrowed)          |
| zone-aggregator       | one closed, one open door                  | doorsOpen 1, doorsTotal 2              |
| zone-aggregator       | door with a position                       | shutter counts unchanged               |
| zone-aggregator       | door in a child zone                       | counted in the parent                  |
| zone-aggregator       | door with no state                         | in total, not open                     |
| binding-candidates    | `door` on a shutter-style device           | same candidates as `shutter`           |
| equipment-manager     | `allShuttersClose` on a zone with a door   | no order to the door                   |

## Validation Plan

- `npm run validate`
- Docs and spec checks (skill, Phase 4)
- Agent review (`sowel-reviewer`)
