# Plan — Spec 172

## Steps

- [x] 1. Extract `PersonalConfirmModal`, `IdentityRow`, `PersonalBadge` and `PersonalConfirmInfo` to `components/plugins/PersonalConfirm.tsx`.
- [x] 2. `PluginsPage` imports them; behaviour unchanged.
- [x] 3. `UpdatesSheet`: catch the 409, hold `pending`, render the dialog, retry on confirm.
- [x] 4. `Personal` badge on the panel rows.
- [x] 5. Tests.
- [x] 6. Docs (EN + FR).

## Test Plan

### Modules to test

- `UpdatesSheet` — the whole point of the spec, and a component with no test file until now.
- `PluginsPage` — the extraction must not change what it renders (its spec 136 test already pins the modal above the sheet).

### Scenarios

| Module       | Scenario                                              | Expected                                                          |
| ------------ | ----------------------------------------------------- | ----------------------------------------------------------------- |
| UpdatesSheet | Personal package, update clicked                      | Dialog with repo, version, truncated fingerprint; no second call  |
| UpdatesSheet | Dialog confirmed                                      | `updatePlugin(id, { confirmed: true, expectedSha256 })`, row gone |
| UpdatesSheet | Dialog cancelled                                      | Exactly one call in total, row still listed and updatable         |
| UpdatesSheet | Ordinary package, update clicked                      | One bare call, no dialog                                          |
| UpdatesSheet | Personal package listed                               | Row carries the `Personal` badge                                  |
| UpdatesSheet | Update fails with an ordinary error                   | Error line, no dialog                                             |
| PluginsPage  | Existing spec 136 case (modal above the detail sheet) | Still passes after the extraction                                 |
