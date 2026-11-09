# Implementation Plan — Spec 198

## Slices

### Slice A — Row, groups, icon, alarm (PR 1)

- [ ] A.1 — `RecipeInfo.icon?` (backend + UI types); `registerExternal` meta; loader passes the manifest icon
- [ ] A.2 — `ui/src/lib/recipe-icons.ts` and `ui/src/lib/recipe-rows.ts`
- [ ] A.3 — `RecipeIconTile`, `RecipeGroup`, `RecipeInstanceRow` variants; `ZoneRecipesSection` renders blocks
- [ ] A.4 — Row click opens the existing log (inline / sheet) for every role; « Réglages » (admin) opens the existing inline form, whose buttons gain Dupliquer / Supprimer
- [ ] A.5 — i18n FR/EN; docs delta (user recipes page, recipe-development EN/FR, api-reference EN/FR)

### Slice B — Journal (PR 2)

- [ ] B.1 — `RecipeJournal`: period groups (`groupActivityLog` adapted to log entries), `HH:MM`, span line, level colours
- [ ] B.2 — Sheet header with the instance's tile, name and line 2

### Slice C — Settings window (PR 3)

- [ ] C.1 — Move the field rendering into `RecipeSettings`; sections from `groupSlots`
- [ ] C.2 — Desktop dialog (rail > 2 sections, sticky footer, Escape / backdrop / close); phone page
- [ ] C.3 — Remove the inline form from the row

### Slice D — state-watch 3.1.0 (other repository)

- [x] D.1 — PR mchacher/sowel-recipe-state-watch#5: wording without (U+00B7), alarm at `error`
- [ ] D.2 — Release, backfill sha256, `chore(registry): bump state-watch to 3.1.0` (maintainer's go)

## Test Plan

| Module                            | Scenario                                                      | Expected                                              |
| --------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| recipe-manager                    | register with `{ icon: "Eye" }`                               | `getRecipes()[0].icon === "Eye"`                      |
| recipe-manager                    | register without meta / with empty icon                       | no `icon` key                                         |
| recipe-icons                      | every recipe icon in `plugins/registry.json`                  | resolves to a component other than the fallback       |
| recipe-icons                      | unknown name, undefined                                       | `ChefHat`                                             |
| recipe-rows `groupZoneInstances`  | A, B, A, C                                                    | group(A: 2) at index 0, single B, single C            |
| recipe-rows `groupZoneInstances`  | all different / empty                                         | all single / empty                                    |
| recipe-rows `isInstanceInAlarm`   | enabled + alarm true / false / missing; disabled + alarm true | true / false / false / false                          |
| recipe-rows `instanceContextLine` | both, equipment only, summary only, neither                   | « Poele, Erreur A01 », « Poele », « Erreur A01 », « » |
| recipe-rows                       | any combination                                               | never contains (U+00B7)                               |
| RecipeInstanceRow (component)     | switch click                                                  | enable/disable action, journal not opened             |
| RecipeInstanceRow (component)     | row click, Enter                                              | journal requested (`getLog`), `aria-expanded="true"`  |
| RecipeInstanceRow (component)     | standard user                                                 | no switch, no « Réglages », journal opens             |
| RecipeInstanceRow (component)     | alarm state                                                   | dot rendered with its label, « en alarme » shown      |
| ZoneRecipesSection (component)    | two instances of one recipe                                   | one group header with count 2, two lines              |
| RecipeJournal (slice B)           | entries over several days                                     | period labels in order, `HH:MM`, error line class     |
| RecipeSettings (slice C)          | open, change a field, save                                    | `updateInstance` called with the params; closes       |
| RecipeSettings (slice C)          | Escape / Annuler                                              | closes without `updateInstance`                       |
| RecipeSettings (slice C)          | recipe with 3+ groups                                         | rail rendered; with 1 group no rail                   |

## Validation Plan

- `npm run validate`
- `bash scripts/check-specs-complete.sh`, `bash scripts/check-specs-index.sh folders`, `bash scripts/check-docs-parity.sh`, `bash scripts/check-docs-impact.sh`
- Manual: the UI dev server against mocked stores at 1440 px and 390 px, light and dark; screenshots in the PR
