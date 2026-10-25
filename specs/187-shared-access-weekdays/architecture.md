# Spec 187 — Architecture

## Data model

No migration. `shared_access.time_windows` and `shared_access_profile.time_windows` are JSON text
(`[{from, to}]`); a window may now carry `days: number[]` (ISO weekdays, 1 = Monday … 7 = Sunday).
Absent reads as every day, so existing rows are valid as they are.

```ts
interface SharedAccessTimeWindow { from: string; to: string; days?: number[] }
```

## Server — `src/shared-access/validity.ts`

- `validateTimeWindows`: validates `days` (`invalid_days`), sorts and de-duplicates them, writes all
  seven as none, and checks overlap pairwise **only between windows that share a day**.
- `inTimeWindows`: adds the weekday test (`getDay() || 7` on the house's clock, which spec 061 makes
  the process's local clock).
- `nextWindowOpening`: walks `ahead = 0..7` days; day 0 only counts starts after now.
- `decide` / `accessStatus` / `buildSession`: unchanged; they call the two functions above.
  `nextOpeningAt` was already an absolute instant, so the API shape is unchanged.

## Visitor page — `src/shared-access/guest-page.ts`

`nextWhen(iso)`: `HH:MM` when the opening is today, `weekday HH:MM` otherwise. The `nextAt` string
loses its « at » for a colon.

## UI

- `lib/shared-access-period.ts`: `ALL_DAYS`, `windowDays`, `withDays`; `checkValidity` mirrors the
  server (`invalid_days`, overlap on a shared day); `validityBody` sends days sorted, all seven as none.
- `components/shared-access/ValidityGroups.tsx`: each window becomes a bordered block; `WindowDays`
  holds the sentence, the toggle and the seven buttons. The unfolded state is local to the editor, by
  window position, and follows a removal.
- `useSaFormat`: `dayName`, `daysSentence`, and `hours()` with a short day prefix.
- i18n: `sharedAccess.validity.*Days*`, `sharedAccess.check.noDay*`, `sharedAccess.error.invalid_days`
  (EN + FR).

## API

`timeWindows` on `POST/PATCH /accesses` and `/profiles` accepts `days`. New refusal code
`invalid_days` (400). Responses return `days` when set.
