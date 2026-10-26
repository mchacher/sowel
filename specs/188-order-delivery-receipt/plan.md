# Spec 188 — Plan

**Status**: Approved 2026-10-26. Implemented on PR #1088 (the first version's receipt code is
removed). Step 12 is done by hand on the instance after merge and release.

## Steps

1. [x] Remove the first version from the branch: `order-receipt-tracker.ts`, `device.order.receipt`
       in `scoped-deps`, dispatch recording, migration 037 `receipt`, receipt UI and i18n.
2. [x] Types: `OrderOutcomeStatus`, `equipment.order.outcome`.
3. [x] Tracker: `kind` on `PendingOrder`, classification (O1), gate state read (O2).
4. [x] Tracker: `end_state` matching, `moving` / `fault` / position (O3) and vocabulary memory (O4).
5. [x] Tracker: outcome emission on status change, alarm keys, `device_fault` reason (O5, O6).
6. [x] Tracker: `retried = true` for both kinds, including held orders (O9).
7. [x] Migration: `shared_access_journal.outcome`, `outcome_expected`.
8. [x] Shared access: row id per press, `open()` result, listener, session presses (O8).
9. [x] WS broadcast + UI store; tile (desktop, mobile, timed), detail, admin journal.
10. [x] Guest page: polling, three endings, never a "press again" invitation.
11. [x] i18n EN/FR, docs EN/FR, specs-index rows.
12. [ ] Live check on Adrien's instance: Portail from closed and from open, coop OPEN / CLOSE.

## Test Plan

| Module                | Scenario                                                         | Expected                                                         |
| --------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| tracker — transition  | pulse, gate closed, `closed` → false after 2 s                   | `pending` then `confirmed`, expected `open`, no alarm            |
| tracker — transition  | pulse, gate closed, nothing for 15 s                             | `unconfirmed`, alarm raised                                      |
| tracker — transition  | pulse, gate open, `closed` → true after 40 s                     | `confirmed`, expected `close`                                    |
| tracker — transition  | pulse, gate open, nothing for 60 s                               | `unconfirmed`, alarm « toujours ouvert »                         |
| tracker — transition  | unconfirmed, then gate closes at 90 s                            | alarm resolved                                                   |
| tracker — transition  | gate state null / device offline                                 | exempt: nothing emitted, no alarm                                |
| tracker — transition  | gate opens then closes inside the window                         | confirmed once, at the opening                                   |
| tracker — transition  | second pulse during the window                                   | first window cancelled, new expectation from the current state   |
| tracker — end_state   | CLOSE, door OPEN, then CLOSING, CLOSED                           | `pending`, `moving`, `confirmed`                                 |
| tracker — end_state   | OPEN, position 100 without `door` change                         | `confirmed`                                                      |
| tracker — end_state   | CLOSE, then FAULT with `why` = BOTTOM                            | `fault`, detail `BOTTOM`, alarm raised                           |
| tracker — end_state   | fault, then CLOSED reported later                                | alarm resolved                                                   |
| tracker — end_state   | CLOSE while door already CLOSED                                  | `confirmed` at once                                              |
| tracker — end_state   | STOP                                                             | exempt                                                           |
| tracker — end_state   | UNKNOWN reported, nothing else for 60 s                          | `unconfirmed`                                                    |
| tracker — O4 guard    | Z2M-like cover reporting OPEN / CLOSE only, CLOSE ordered        | exempt, no alarm after 60 s                                      |
| tracker — O4 guard    | device reported CLOSED once since start, now OPEN, CLOSE ordered | tracked                                                          |
| tracker — O9          | transition unconfirmed, device comes back online                 | no re-dispatch                                                   |
| tracker — O9          | pulse while integration disconnected, integration connects       | no replay; `unconfirmed` after the grace                         |
| tracker — regression  | spec 141 suite                                                   | unchanged, green                                                 |
| shared-access-manager | open on a closed tracked gate                                    | `{ok, outcome:"pending", expected:"open"}`, row `pending`        |
| shared-access-manager | confirmed after open                                             | row `confirmed`, session press shows it                          |
| shared-access-manager | gate state unknown                                               | `outcome` absent, row NULL                                       |
| shared-access-manager | unconfirmed                                                      | row `unconfirmed`, use still counted                             |
| shared-access-manager | coop outcome while a gate press is pending                       | the press row is untouched                                       |
| migration             | existing rows                                                    | `outcome` NULL                                                   |
| UI widget             | each status, desktop / mobile / timed                            | line per O5; `confirmed` clears after 4 s; spinner drops at 70 s |
| guest page            | confirmed / unconfirmed / exempt                                 | pill and message per O8; no "press again" wording anywhere       |
