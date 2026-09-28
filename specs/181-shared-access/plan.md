# Spec 181 — Plan

Spec agreed upstream on 2026-09-27 (review on #970); all seven steps are done on `feat/shared-access`.

## Steps

1. **Model and rules** — migration 035, store, `codes`, `validity`, manager (create, edit, hold,
   revoke, delete, change the code, purge). No HTTP yet.
2. **Pressing** — enrolment, the guessing budget, the decision, the per-gate queue, the dispatch
   through `executeOrder`, Activity attribution, events and alarms.
3. **Public surface** — the static page, the public routes, `isPublicRoute`, headers,
   the 404 while disabled.
4. **Owner API and page** — admin routes, `SharedAccessPage`, sidebar and drawer entries.
5. **Equipment panel and settings** — `SharedAccessPanel`, the opt-in switch, the public address.
6. **Plugin API** — profiles (owner routes and editor), `deps.sharedAccess`, scoped, disabled error.
7. **Docs** — user guide EN/FR, API reference EN/FR, plugin development EN/FR (R9), release notes.

## Test Plan

### Modules to test

`codes`, `validity`, `guessing`, `gate-queue`, `shared-access-manager`, `shared-access-store`,
routes (admin and public), `plugin-api`, `guest-page`, and in the UI `SharedAccessPage`,
`SharedAccessPanel`, the date-time picker, the settings switch.

### Scenarios

| Module        | Scenario                                                | Expected                                                            |
| ------------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| codes         | a code typed with dashes, spaces, lower case, I/L/O/U   | matches                                                             |
| codes         | the link token and the phone token                      | only their hashes are stored                                        |
| codes         | an access created without a code                        | enrols from its link only                                           |
| validity      | before, inside, after the period; outside a time window | the matching refusal, with `activeAt` / `nextOpeningAt`             |
| validity      | widening an external window earlier / later; shortening | accepted / refused                                                  |
| validity      | until before from                                       | `end_before_start`                                                  |
| manager       | create without gate, with an unknown gate               | `no_gate` / `unknown_gate`                                          |
| manager       | create with a non-`gate` equipment                      | `unsupported_equipment`                                             |
| manager       | change the code with and without cutting phones         | phones kept / dropped                                               |
| manager       | delete a live access                                    | `still_live`                                                        |
| manager       | disarm one gate of an access listing two                | the other still opens                                               |
| manager       | delete the equipment                                    | gone from every access and profile, and its arming row              |
| guessing      | 40 wrong codes then the right one                       | enrolled, no delay                                                  |
| guessing      | failures 11–14                                          | held 1, 2, 4, 8 s; never past 10 s                                  |
| guessing      | 25 failures                                             | one alert per window                                                |
| guessing      | 100 wrong codes sent at once                            | at most 32 held, the rest `too_many` at once                        |
| guessing      | a wrong link token                                      | counted as a failure, like a wrong code                             |
| press         | listed, armed, valid                                    | `executeOrder(gate, "command", value)` once, source `shared_access` |
| press         | not listed / disarmed / suspended / over a ceiling      | nothing dispatched, reason returned                                 |
| press         | two presses within 2 s                                  | one dispatch                                                        |
| press         | gate order fails                                        | `gate_error`, journalled                                            |
| press         | gate order silent for 15 s                              | `gate_error`, the queue moves on                                    |
| press         | a sixth press waiting on one gate                       | `busy` at once, nothing dispatched                                  |
| enrol         | a 51st phone on one access                              | `409 too_many_phones`                                               |
| public routes | setting off                                             | 404 on page and owner API; 401 on public API, like an unknown route |
| public routes | session payload                                         | never carries the gate's state                                      |
| public routes | page headers                                            | CSP, noindex, no-store, no cookie                                   |
| admin routes  | non-admin                                               | 403                                                                 |
| plugin-api    | replayed upsert                                         | no new code, no duplicate                                           |
| plugin-api    | update after the owner widened                          | widening kept                                                       |
| plugin-api    | another plugin's externalId or profile                  | invisible                                                           |
| plugin-api    | upsert on a profile not granted to it                   | `UnknownProfileError`, nothing created                              |
| plugin-api    | upsert creates                                          | the profile's gates and hours, none from the plugin                 |
| plugin-api    | upsert without `until`                                  | `NoEndError`, nothing created                                       |
| plugin-api    | upsert on a profile listing no gate                     | `ProfileIncompleteError`, nothing created                           |
| plugin-api    | upsert with no `profileId`                              | made on the default profile, if granted                             |
| manager       | first enablement; delete the default profile            | « Par défaut » created once; deletion refused                       |
| plugin-api    | same guest, second stay                                 | new code and link; the first stops at its end                       |
| plugin-api    | upsert on a stay the owner revoked                      | `revoked` (409), nothing changed                                    |
| plugin-api    | upsert on a stay the owner deleted                      | `revoked` from the tombstone, nothing created                       |
| press         | external access past its end, plugin stopped            | `expired`, nothing dispatched                                       |
| plugin-api    | setting off                                             | `SharedAccessDisabledError`                                         |
| public page   | disc pulled past its socket                             | one press sent                                                      |
| public page   | disc released short, and keyboard confirm               | nothing sent, then one press sent                                   |
| UI page       | editor of an access with a period                       | opens (regression from the first attempt)                           |
| UI picker     | same day as the start                                   | earlier hours and minutes disabled, steps of 5                      |
| UI panel      | no access / accesses / disarmed                         | create button / count and switch / refused wording                  |
| UI dialogs    | open centred (Sowel's reset zeroes `margin`)            | `margin: auto` kept                                                 |

### Retro-compat

With the setting off, the existing API, pages and equipment pages are unchanged — pinned by a
test that runs the equipment page and the route table with the feature disabled.
