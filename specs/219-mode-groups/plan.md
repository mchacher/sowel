# Implementation Plan — Spec 219

## Tasks

- [x] 1 — Types and migration 047
- [x] 2 — ModeManager: group on create/update, exclusive activation, conflict resolution
- [x] 3 — Tests for ModeManager
- [x] 4 — API bodies
- [x] 5 — UI: `mode-groups` lib and test, store and api, form, Modes page, sidebar, i18n
- [x] 6 — Docs EN/FR

## Test Plan

### Modules to test

- `src/modes/mode-manager.ts`
- `ui/src/lib/mode-groups.ts`

### Scenarios

| Module       | Scenario                                                   | Expected                                                                                 |
| ------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| mode-manager | Create with group, blank group, 51-character group         | `group` set / absent / ModeError 400                                                     |
| mode-manager | Update group to another, to `null`, omitted                | changed / cleared / kept                                                                 |
| mode-manager | Activate grouped mode while a sibling is active            | sibling inactive, `mode.deactivated` then `mode.activated`, impacts of the new mode only |
| mode-manager | Activate grouped mode: other group and ungrouped modes     | untouched                                                                                |
| mode-manager | Activate ungrouped mode with others active                 | all stay active (retro-compat)                                                           |
| mode-manager | Deactivate the active mode of a group                      | none active                                                                              |
| mode-manager | Activation sets `activatedAt`                              | ISO date present                                                                         |
| mode-manager | Move active mode into group with an older active mode      | the moved (more recent) stays, the other deactivated with event                          |
| mode-manager | Move active mode into group with a more recent active mode | the moved one deactivated                                                                |
| mode-manager | Move inactive mode into a group with an active mode        | nothing deactivated                                                                      |
| migration    | Existing active mode after 047                             | still active, `activatedAt` = previous `updatedAt`, no group                             |
| mode-groups  | No group / mixed / several groups                          | `others` only / split / groups sorted by name, modes kept in order                       |
| mode-groups  | `modeGroupNames`                                           | distinct names, sorted                                                                   |
