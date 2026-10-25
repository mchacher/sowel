# Spec 187 — Plan

## Steps

- [x] Types (`SharedAccessTimeWindow.days`, server and UI)
- [x] `validity.ts`: validation, `inTimeWindows`, `nextWindowOpening`
- [x] Visitor page: weekday in the next opening
- [x] UI logic: `shared-access-period.ts`, `useSaFormat`, `useValidityText`, error field map
- [x] UI: `WindowDays` in `ValidityGroups`
- [x] i18n EN + FR
- [x] Spec 181 amended, docs (user EN/FR, API reference EN/FR), specs index EN/FR

## Test Plan

| Module | Scenario | Expected |
| --- | --- | --- |
| validity | Friday window, press on Thursday / Friday / Saturday | refused / opens / refused |
| validity | Window with no days | every weekday opens, as before |
| validity | Next opening from Friday before, Thursday evening, Saturday, Friday past the end | same Friday, that Friday, next Friday, next Friday |
| validity | Two windows on different days | earliest start of the coming days |
| validity | `days` empty, `[0]`, `[8]`, `[1.5]`, `"5"`, `[null]` | `invalid_days` |
| validity | Overlap on different days / shared day / one window with no days | accepted / refused / refused |
| validity | `[7,5,5]` and all seven | `[5,7]` and no days |
| validity | A press outside the day | `outside_hours` with the next opening; none past `validUntil` |
| period lib | Same overlap, empty-days and body rules as the server | mirrored |
| period lib | An access's days survive opening its editor | kept |
| editor | Days folded; opened on request; Weekend then Saturday off | « Every day » → Sunday only; body `days: [7]` |
| editor | Every day unticked | buttons open by themselves, save refused |
