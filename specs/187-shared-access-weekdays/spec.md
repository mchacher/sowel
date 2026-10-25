# Spec 187 — Shared access: days of the week on time windows

**Status**: implemented on `feat/shared-access-weekdays`, awaiting review
**Amends**: spec 181 (R3.10, R4.12, R5.22; removes « Days of the week on time windows » from its out-of-scope list)

## Problem

A time window on a shared access (spec 181, R3.10) applies **every day**. « Every Friday from 18:00 to
22:00 » — the students who come on Friday evening, the tradesperson who comes on Tuesdays — cannot be
said: the owner has to suspend and resume the access by hand, or hand out a code that works all week.

## Rules

1. **A time window may name its days**: ISO weekdays, `1` = Monday … `7` = Sunday, on the house's
   clock. `{ "from": "18:00", "to": "22:00", "days": [5] }` is « every Friday, 18:00 to 22:00 ».
2. **No `days` means every day.** Every window written before this spec reads that way; there is **no
   migration**. « All seven » is stored as no days, so an unrestricted window looks as it always did.
3. **`days`, when written, names at least one real weekday.** An empty list, a number outside 1–7, a
   non-integer or a non-list is refused with `invalid_days`. An empty list is never read as « every
   day »: that is the opposite of what an owner who unticked every day meant.
4. **Two windows overlap only on a day they share.** Tuesday 08:00–12:00 and Friday 10:00–14:00 are
   fine; Tuesday-and-Friday 08:00–12:00 with Friday 10:00–14:00 is `windows_overlap`. A window with no
   days shares every day. The other rules stay: `HH:MM`, not crossing midnight.
5. **The decision (R4.12)** is inside a window when **today's weekday is one of its days** and the
   time is inside its hours. Nothing else about the order of refusals changes.
6. **The next opening (R5.22)** is the earliest start among the windows of today (after now), then of
   each following day, up to the same weekday next week. It is still omitted when it would fall after
   the access ends.
7. **The visitor page says the day** when the next opening is not today: « Next opening: Friday 18:00 »
   (« Prochaine ouverture : vendredi 18:00 »). The wording moves from « at » to a colon so it reads
   with a day or without.
8. **The editor folds the days.** Each window shows a sentence — « Every day », « Every Friday »,
   « Monday to Friday », « Mondays, Wednesdays and Fridays » — and a « Choose days » link. Only then do
   seven day buttons appear, with « All », « Weekdays » and « Weekend » shortcuts. With no day left the
   buttons open by themselves and the sentence turns red, and the save is refused before it is sent.
9. **Lists say it too**: an access line reads `Fri 18:00–22:00`, `Mon–Fri 08:00–12:00`, or just the
   hours when it is every day.
10. Profiles carry the same windows, so a profile may carry days. A plugin that creates accesses
    (`plugin-api`) goes through the same validation.

## Acceptance criteria

- [x] A window with `days: [5]` opens on Friday only; a window without `days` behaves as before.
- [x] `days` empty or unreal is refused (`invalid_days`); all seven is stored as none.
- [x] Overlap is refused only on a shared day; a window with no days shares every day.
- [x] The next opening names the right day, and a week on when today's has passed.
- [x] The visitor page names the weekday when the opening is not today.
- [x] The editor shows the days folded by default, opens them on request or when none is left, and
      refuses an empty selection before sending.
- [x] An access saved before this spec keeps its windows and reads every day.

## Out of scope

- Dates or exceptions on windows (« not on 14 July »), or a window that crosses midnight.
- A different set of days for the access as a whole: the days belong to each window.
