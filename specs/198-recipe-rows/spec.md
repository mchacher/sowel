# Spec 198 — Recipe rows: two lines, grouped instances, journal on click, settings window

## Context

Issue #1188. In a zone's Comportements panel every recipe instance takes three lines: the name, the equipment (#1165), then a row of three 12 px icons (log, duplicate, delete). Two instances of one recipe on one equipment read the same: the RDC zone shows « Surveillance d'état / Poele » twice although one watches `error_A01` and the other `error_A02`; the Maison zone repeats « Surveillance d'état / Onduleur » three times.

The log shows times without a date (an alarm of 26 October reads like this morning), is admin-only, and on a phone opens a sheet titled « Journal » that does not name the recipe. The settings open inline as a stack of every slot with its description (about 560 px for state-watch, 21 slots for VMC hygro-pilotée).

The maintainer validated a mockup after six iterations: https://claude.ai/artifact/7TaJMiqGBEnYX44CzCWkcM. Decisions taken there: one switch alone on the right (no « … » menu), a clickable row, the journal alone on click (no tabs, not settings and journal together), settings in their own window, and no middle dot (U+00B7) anywhere.

## Goals

1. A recipe instance reads in two lines and tells itself apart from its siblings.
2. Several instances of one recipe in a zone read as one group.
3. A recipe is recognisable by its icon; an instance in alarm is visible at a glance.
4. The journal is one click away for every user and reads like the Activity panel.
5. Settings, which can be long, get room: a window on desktop, a page on a phone.

## Non-Goals

- No change to the recipe engine, the instance data model or the REST routes (one optional read-only field is added to `RecipeInfo`).
- No « several states » state-watch: one instance still watches one value; the grouping answers the issue on screen.
- No translation of the recipes' own log messages (they stay as each recipe writes them).
- No change to the Dashboard recipe tile (spec 169) or to the add-recipe form.
- The (U+00B7) still present in other recipes' summaries (ev-charge-smart, pool-pump-schedule, smart-socket-heating) and elsewhere in the UI is a follow-up, not this spec.

## Functional Requirements

### FR1 — Recipe icon

`RecipeInfo` gains an optional `icon`: the Lucide name the installed package's manifest declares (`manifest.json`, already filled for every official recipe). The UI resolves it through a closed map of the icons the official registry uses, with `ChefHat` as fallback (an unknown or missing name, a personal recipe with another icon). No wildcard import of `lucide-react` (#1187).

### FR2 — Two-line row

A single instance renders: icon tile (32 px, spans both lines), line 1 the recipe name, line 2 « <equipment list>, <state.summary> » (the comma only when both exist), then the live pills (countdown, override badge, mode cycle) on the same line 2. The switch is alone on the right, centred on both lines, admin only. A disabled instance is drawn at half opacity, switch off, as today.

### FR3 — Grouping

When a zone has two or more instances of the same recipe, they render as one group: a header (icon tile, recipe name, instance count) then one line per instance: « <equipment list>, <summary> » with its own switch. The group sits at the position of its first instance in the zone's list; single instances keep their order.

### FR4 — Alarm

An instance is in alarm when it is enabled and `state.alarm === true`. Its icon tile carries a red dot (mode-row pattern) and its line turns red. The words are the recipe's: state-watch's summary already reads « Erreur A02 en alarme », so the UI adds none (it would read « en alarme » twice). A group's header tile carries the dot when any of its instances is in alarm. The dot has a text alternative.

### FR5 — Clickable row

The whole row (or instance line) is a button: hover tint, `cursor: pointer`, Enter and Space open it, `aria-expanded` reflects it. The switch stops propagation: toggling never opens the row. On a phone the switch and every instance line are at least 44 px tall.

### FR6 — Journal on click

Opening a row shows its journal only, for every role (the read route is already open to standard users):

- desktop: inline under the row; a second click closes it;
- phone: the bottom sheet, whose header shows the icon, the recipe name and the instance's line 2.

The journal is grouped by part of the day with the Activity labels (`groupActivityLog`, `logPeriodLabel`), times as `HH:MM`, a « depuis … » span line (`logSpanLabel`), `error` lines in red and `warn` in orange. It refreshes every 5 s while open, as today.

Its header has a « Réglages » button, admin only.

### FR7 — Settings window

« Réglages » opens the instance's settings:

- desktop: a centred dialog, 720 px max, header (icon, « Réglages », recipe name and line 2, close), scrolling body, sticky footer; slot groups (`groupSlots`) become sections titled by their group label; with more than two sections a rail on the left lists them and scrolls to each; the footer holds Dupliquer and Supprimer on the left, the change status, Annuler and Enregistrer on the right;
- phone: a full-screen page with a back button, the sections stacked, Annuler and Enregistrer at the bottom; no Dupliquer nor Supprimer (as today).

The fields, their validation, the optional groups (« + group » / « − »), the changed-field marking and the save call are those of today's inline form. Escape and the close button close without saving; a backdrop click too.

### FR8 — Wording

No (U+00B7) in any text this spec adds. Equipment and summary are joined by « , ».

## Acceptance Criteria

- [ ] `GET /api/v1/recipes` returns `icon` for a recipe whose manifest declares one, and omits it otherwise.
- [ ] Every icon used in `plugins/registry.json` for a recipe resolves to its Lucide component; an unknown one to `ChefHat`.
- [ ] RDC: the two stove watches render under one « Surveillance d'état » group as « Poele, Erreur A01 après 1 min » and « Poele, Erreur A02 en alarme », the group header dotted and the A02 line in red.
- [ ] A single instance renders in two lines; pills stay on line 2.
- [ ] Clicking the switch toggles and does not open; clicking elsewhere on the row opens the journal; Enter/Space too.
- [ ] A standard user opens a journal; sees no switch, no « Réglages ».
- [ ] The journal shows period separators and `HH:MM`; an `error` line is red.
- [ ] « Réglages » opens the dialog (desktop) or the page (phone); Save, Cancel, Escape behave as specified; Dupliquer and Supprimer only in the desktop dialog footer.
- [ ] No (U+00B7) added.

## Edge Cases

- Recipe not installed any more (instance of an unknown `recipeId`): row named by the id, chef hat, no « Réglages » (nothing to edit), journal still readable.
- Instance with no equipment slot and no summary: line 2 is empty and the row keeps its two-line height.
- An instance whose equipment was deleted: no equipment name, the summary alone.
- A group whose instances are all disabled: each line at half opacity, the header normal.
- `state.alarm` true on a disabled instance: no dot (a disabled recipe raises nothing).
- An empty log: « Aucun journal » as today.
- Settings of a recipe with no slot group: no rail, one untitled section.

## Docs Delta

| Page (EN and FR)                                  | Change                                                                                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/user/recipes.md` (no FR page exists)        | The recipe list paragraph: two lines, groups, icon and alarm dot, a click opens the journal (for everyone), « Réglages » opens the settings window.      |
| `docs/technical/recipe-development.md` + `.fr.md` | New « On the zone page » section: the manifest `icon` (closed set, fallback), `state.summary` on line 2 (short, no (U+00B7)), `state.alarm` and its dot. |
| `docs/technical/api-reference.md` + `.fr.md`      | `GET /api/v1/recipes`: optional `icon` field.                                                                                                            |

Screenshots to retake: none (the recipes page has none of the zone row).
