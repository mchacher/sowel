# Spec 189 — Delete ended external accesses

Status: Approved (2026-10-26)
Amends: spec 181 R10 (housekeeping)

## Problem

A plugin (the guestFlow connector, spec 181 R9) creates one external access per stay. When the stay
ends, housekeeping nulls the code seven days later (R10.36), but the access line stays in « Accès
partagés » forever. A gîte with one booking a week piles up 50+ dead lines a year, and the owner has
to delete each one by hand (R3.11).

## Requirement

**R10.37** — An **external** access (`kind = 'external'`) is **deleted by housekeeping seven days
after it ended**: `valid_until < now − 7 days`, or `revoked_at < now − 7 days`. This is the same
predicate and the same delay as the code nulling of R10.36: once the code is gone, the line serves
no purpose.

The deletion is the owner's delete (R3.11), done by the house:

1. A journal line `deleted` is written with actor `housekeeping`; the journal itself is kept (it has
   no foreign key, and « who came in that night » outlives the access).
2. A tombstone `(source_plugin, external_id)` is written (R9.34), so a later replay of that stay
   answers `revoked` and creates nothing. guestFlow never lists an ended stay (its connector spec,
   rule 7), so in practice nothing replays it.
3. Its gates and phones go with it (`ON DELETE CASCADE`, unchanged).
4. An open « too many phones » alarm of that access is resolved.
5. The UI is told once per housekeeping run (`changed()`), not once per line.

**Manual accesses are never deleted by housekeeping.** The owner made them and may extend or reuse
them; they keep R3.11 (delete by hand).

## Acceptance criteria

- [x] An external access ended 7 days + 1 h ago is gone after `purge()`; at 6 days it is still there.
- [x] An external access revoked 7 days + 1 h ago (its stay still in the future) is gone, and a
      later `upsert` of the same `externalId` answers `revoked`.
- [x] A manual access ended a month ago is still listed (code nulled).
- [x] A live or not-yet external access is untouched, whatever its age.
- [x] The access's journal lines survive, plus one `deleted` line by `housekeeping`.
- [x] An access extended by the owner (`extended_until`) is kept until 7 days after the extension.
- [x] The housekeeping log line counts deleted accesses.
- [x] The user docs (EN + FR) say ended guest-platform accesses disappear seven days after they end.

## Out of scope

- A configurable delay, and any change to manual accesses.
- Any change to the guestFlow connector plugin or to guestFlow.

## Edge cases

- Feature turned off: housekeeping still runs today regardless; it keeps doing so (no plugin call).
- An access whose source plugin was uninstalled: still external, still deleted on the same rule.
- The deletion fails midway: it is one transaction per run; the error is logged like today.
