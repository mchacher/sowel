# Spec 188 — Plan

## Steps

1. [x] Types: statuses + two events.
2. [x] Migration 037: `shared_access_journal.receipt`.
3. [x] `scoped-deps`: allow and validate `device.order.receipt`.
4. [x] `equipment-manager`: record dispatches for correlation.
5. [x] `order-receipt-tracker`: correlation, re-emit, alarm; wired in `index.ts`.
6. [x] Shared access: journal receipt, `open()` result, session presses.
7. [x] WS broadcast.
8. [x] UI: store, tile/detail status line, admin journal.
9. [x] Guest page: follow-up and outcomes.
10. [x] i18n EN/FR, docs EN/FR.
11. [ ] Plugin lora2mqtt PR (separate repository, opened in parallel).

## Test Plan

| Module                | Scenario                                                           | Expected                                                 |
| --------------------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| scoped-deps           | plugin emits `device.order.receipt` for its own integration        | forwarded                                                |
| scoped-deps           | receipt with another plugin's integrationId                        | dropped, warn                                            |
| order-receipt-tracker | pending then delivered                                             | `equipment.order.receipt` ×2, no alarm                   |
| order-receipt-tracker | unconfirmed                                                        | alarm raised with equipment name and value               |
| order-receipt-tracker | unconfirmed then late delivered                                    | alarm resolved, `late: true`                             |
| order-receipt-tracker | refused / not_received                                             | alarm raised                                             |
| order-receipt-tracker | not_received then delivered                                        | upgraded, alarm resolved                                 |
| order-receipt-tracker | second order supersedes, first's receipt arrives                   | first's receipt ignored                                  |
| order-receipt-tracker | new pending while alarm raised                                     | alarm stays                                              |
| order-receipt-tracker | receipt with no order in 2 min                                     | ignored                                                  |
| order-receipt-tracker | device never sends pending                                         | nothing emitted                                          |
| shared-access-manager | open on a receipt gate                                             | `{ok, receipt:"pending"}`, journal row receipt `pending` |
| shared-access-manager | delivered after open                                               | journal row `delivered`, session press shows it          |
| shared-access-manager | gate without receipts                                              | `receipt` absent, row NULL                               |
| shared-access-manager | unconfirmed                                                        | row `unconfirmed`, use still counted                     |
| shared-access-manager | receipt for another equipment (coop) while a gate press is pending | the press row is untouched                               |
| migration 037         | existing rows                                                      | `receipt` NULL                                           |
| UI widget             | each status                                                        | line text per R4, delivered clears after 4 s             |
| plugin lora2mqtt      | executeOrder on a receipts node                                    | `#id` in payload, `pending` emitted, returns at once     |
| plugin lora2mqtt      | `/receipt` applied / refused / timeout / received / not_received   | mapped status                                            |
| plugin lora2mqtt      | no `/receipt` in 20 s                                              | `unconfirmed`                                            |
| plugin lora2mqtt      | node without `receipts`                                            | no `#id`, no event                                       |
