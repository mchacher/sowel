# Spec 181 — Plan

Spec first: nothing below starts before the spec is agreed upstream.

## Steps

1. **Model and rules** — migration 035, store, `codes`, `validity`, manager (create, edit, hold,
   revoke, delete, change the code, purge). No HTTP yet.
2. **Pressing** — enrolment, the guessing budget, the decision, the per-gate queue, the dispatch
   through `executeOrder`, Activity attribution, events and alarms.
3. **Public surface** — the static page, the public routes, `isPublicRoute`, rate limit, headers,
   the 404 while disabled.
4. **Owner API and page** — admin routes, `SharedAccessPage`, sidebar and drawer entries.
5. **Equipment panel and settings** — `SharedAccessPanel`, the opt-in switch, the public address.
6. **Plugin API** — `deps.sharedAccess`, scoped, disabled error.
7. **Docs** — user guide EN/FR, API reference EN/FR, plugin development EN/FR (R9), release notes.

## Test Plan

### Modules to test

`codes`, `validity`, `guessing`, `gate-queue`, `shared-access-manager`, `shared-access-store`,
routes (admin and public), `plugin-api`, `guest-page`, and in the UI `SharedAccessPage`,
`SharedAccessPanel`, the date-time picker, the settings switch.

### Scenarios

| Module        | Scenario                                                | Expected                                                |
| ------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| codes         | a code typed with dashes, spaces, lower case, I/L/O/U   | matches                                                 |
| codes         | the phone token                                         | only its hash is stored                                 |
| validity      | before, inside, after the period; outside a time window | the matching refusal, with `activeAt` / `nextOpeningAt` |
| validity      | widening an external window earlier / later; shortening | accepted / refused                                      |
| validity      | until before from                                       | `end_before_start`                                      |
| manager       | create without gate, with an unknown gate               | `no_gate` / `unknown_gate`                              |
| manager       | change the code with and without cutting phones         | phones kept / dropped                                   |
| manager       | delete a live access                                    | `still_live`                                            |
| manager       | turn a gate off that an access depends on alone         | `gate_in_use`                                           |
| manager       | delete the equipment                                    | gate gone, accesses forget it                           |
| guessing      | 40 wrong codes then the right one                       | enrolled, no delay                                      |
| guessing      | failures 11–14                                          | held 1, 2, 4, 8 s; never past 10 s                      |
| guessing      | 25 failures                                             | one alert per window                                    |
| guessing      | one code tried 10 times                                 | locked an hour                                          |
| press         | listed, armed, valid                                    | `executeOrder(gate, alias, value)` once                 |
| press         | not listed / disarmed / suspended / over a ceiling      | nothing dispatched, reason returned                     |
| press         | two presses within 2 s                                  | one dispatch                                            |
| press         | gate order fails                                        | `gate_error`, journalled                                |
| public routes | setting off                                             | 404 on page and API                                     |
| public routes | session payload                                         | never carries the gate's state                          |
| public routes | page headers                                            | CSP, noindex, no-store, no cookie                       |
| admin routes  | non-admin                                               | 403                                                     |
| plugin-api    | replayed upsert                                         | no new code, no duplicate                               |
| plugin-api    | update after the owner widened                          | widening kept                                           |
| plugin-api    | another plugin's externalId                             | invisible                                               |
| plugin-api    | setting off                                             | `SharedAccessDisabledError`                             |
| public page   | disc pulled past its socket                             | one press sent                                          |
| public page   | disc released short, and keyboard confirm               | nothing sent, then one press sent                       |
| UI page       | editor of an access with a period                       | opens (regression from the first attempt)               |
| UI picker     | same day as the start                                   | earlier hours and minutes disabled, steps of 5          |
| UI panel      | gate off / on / disarmed                                | button / switch and count / refused wording             |
| UI dialogs    | open centred (Sowel's reset zeroes `margin`)            | `margin: auto` kept                                     |

### Retro-compat

With the setting off, the existing API, pages and equipment pages are unchanged — pinned by a
test that runs the equipment page and the route table with the feature disabled.
