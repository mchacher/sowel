# Spec 219 — Mode groups: modes that exclude each other

**Status**: Implemented 2026-11-28.

## Context

Modes are not exclusive: any number can be active at once (spec 010). A household that has
« Home », « Away » and « Holidays » wants exactly one of them on, and today it has to switch the
old one off by hand, or write both orders into every calendar slot and button binding. When one
of them is forgotten, two contradictory modes stay active together.

## Goals

1. A mode may belong to a **group**. Within a group, activating a mode deactivates the others.
2. The rule holds whatever activates the mode: the Modes page, a calendar slot, a button
   binding, the API.
3. Modes outside any group behave exactly as today.

## Non-Goals

- A mandatory mode per group (« one must always be on »): a group may have no active mode.
- A screen to manage groups: a group exists as long as one mode carries its name.
- Renaming a group in one step (the modes are edited one by one).
- Group order other than alphabetical.

## Behaviour

- The group is a name carried by the mode (`group`, optional, trimmed, at most 50 characters,
  empty means none). Two modes with the same name are in the same group. A group whose last mode
  leaves it no longer exists.
- `activateMode(id)` on a grouped mode first deactivates every other active mode of the group
  (one `mode.deactivated` event each, no impact executed, as a manual deactivation today), then
  activates the mode as today.
- Deactivating the active mode of a group is allowed and leaves the group with none active.
- Moving an active mode into a group where another mode is active (create or update): the most
  recently activated one stays active, the others are deactivated (`mode.deactivated` each).
  Activation time is a new `activatedAt`; a mode active before this spec takes its `updatedAt`.
- A non-admin user still cannot change a mode's group (configuration, spec 131).

## UI (validated mockup, variant A)

- **Modes page**: one card per group, its name as a header with « un seul actif », its modes as
  rows with a radio button instead of the switch. Clicking the checked radio deactivates the
  mode. The ungrouped modes follow under « Autres modes », with their switches. Without any
  group the page is unchanged (no « Autres modes » label).
- **Sidebar**: under « Modes », each group as a small label followed by its modes, then
  « Autres » and the ungrouped modes. Without any group, unchanged.
- **Mode form** (create and edit, admin): a « Groupe » field, a select listing « Aucun », the
  existing groups and « + Nouveau groupe… », which turns into a text input. Help line: « Dans un
  groupe, activer ce mode désactive les autres modes du groupe. » When the edited mode is active
  and the chosen group already has an active mode, a warning says that only the most recently
  activated stays active.
- English labels fit a 375 px phone (checked on the mockup).

## Acceptance Criteria

- [x] AC1 — Activating a grouped mode deactivates the other active modes of its group, events
      included; modes of other groups and ungrouped modes are untouched.
- [x] AC2 — Calendar slots and button bindings go through the same rule (they call
      `activateMode`).
- [x] AC3 — Deactivating the active mode of a group leaves none active.
- [x] AC4 — Putting an active mode in a group with another active mode keeps the most recently
      activated.
- [x] AC5 — `group` is accepted on `POST` and `PUT /api/v1/modes`, returned on every mode; empty
      or blank clears it.
- [x] AC6 — Modes page and sidebar render groups as in the mockup; unchanged without groups.
- [x] AC7 — Mode form offers existing groups and a new one; warning on conflict.
- [x] AC8 — An existing installation migrates with no group and its active modes intact.

## Edge cases

- Same name with different case or spaces: trimmed, compared exactly (the select reuses the
  existing spelling, so a typo only happens by typing a new group).
- A backup from before this spec restores with no groups (missing columns keep their defaults).
- A backup from after this spec into an older Sowel: the new columns are skipped (existing
  `columnsSkipped` mechanism).
- Deleting the last mode of a group: the group disappears from the form's list.
- A calendar slot that switches on two modes of one group runs both in turn: the first one's
  impacts run, then the second replaces it. The docs say so.
- Restoring a backup taken before this spec: active modes have no `activatedAt` (the migration
  backfill does not run again) and count as the oldest in a conflict. Harmless.
- A sibling switched off by the group rule gets a log line and a `mode.deactivated` event, but no
  audit row of its own: the audit row is the activation that caused it.

## Docs delta

| Page                                           | Change                                                       |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `docs/user/modes.md` + `docs/user/modes.fr.md` | New « Mode groups » section; « Understanding modes » amended |
| `docs/technical/data-model/modes.md`           | `group`, `activatedAt`, behaviour bullet rewritten, schema   |
| `docs/technical/api-reference.md` + `.fr.md`   | `group` in the create and update bodies                      |

The user page also said « only one mode can be active at a time », which was wrong before this spec; corrected. Screenshots `modes-en.png` / `modes-fr.png` show a setup without groups and stay valid; a grouped capture can be added with `/sowel-docs` later.
