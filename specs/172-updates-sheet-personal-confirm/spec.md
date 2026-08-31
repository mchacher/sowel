# Spec 172 — The updates panel can finish a personal update

**Status**: implemented
**Scope**: UI (updates sheet, plugins page)
**Follows**: [spec 136](../136-personal-plugin-sources/spec.md), [spec 107](../107-update-row-changelog-link/spec.md)

## Problem

The top-bar updates panel offers an **Update** button for every outdated package. For a package installed from a **personal source**, that button cannot work: spec 136 makes the server answer `409 PersonalPluginConfirmationRequired`, carrying the version and the SHA256 fingerprint the user has to approve. The Plugins page knows how to answer that — it raises the fingerprint dialog and retries. The updates panel does not: it catches the error and prints its raw code.

So the user reads `PersonalPluginConfirmationRequired` in red, and has to go to **Administration → Plugins → Installed** and update from the row instead. The panel that exists to be the one place updates happen is the one place a personal update cannot happen.

The documentation already promises the opposite: _"Every later update shows the same dialog again with the new version and new fingerprint."_ It shows nothing of the sort from the top bar.

## Design principle — the confirmation follows the button, not the page

The fix is **not** to weaken the gate. A new release is new content; re-pinning its fingerprint is the whole point of spec 136, and a "trust this source forever" checkbox would give away the only guarantee it offers.

The fix is that a confirmation belongs wherever the action is offered. Any surface that can start an update must be able to finish one.

## Goal

Make the updates panel handle the personal-source confirmation, with the same dialog, the same identity, and the same pinning as the Plugins page.

## In scope

- The updates panel catches `PersonalPluginConfirmationRequiredError` and raises the fingerprint dialog, retrying with `confirmed: true` and the fingerprint on approval.
- `PersonalConfirmModal` (and the `Personal` badge) extracted from `PluginsPage` into a shared component, so the two surfaces cannot drift apart.
- The rows of the panel carry the **Personal** badge, so the extra step is expected rather than surprising.

## Out of scope

- The confirmation itself, in any form: same dialog, same fields, same per-version re-approval.
- Bulk update. `UpdateAllBanner` already excludes personal packages and names them; a fingerprint is a per-package decision and stays one.
- The core (Sowel itself) update row, which has no fingerprint step.
- Install. It happens from the store, which already has the dialog.

## Functional rules

1. **FR-1 — The dialog appears.** An update refused with `409 PersonalPluginConfirmationRequired` opens the fingerprint dialog in the updates panel, showing the repository, the version and the pinned fingerprint the server returned — the same three identity rows as on the Plugins page.

2. **FR-2 — Approval finishes the job.** Confirming retries with `confirmed: true` and `expectedSha256`, then behaves exactly as a successful update: the row leaves the list and the badge count is refreshed.

3. **FR-3 — Refusal changes nothing.** Cancelling sends no second request, leaves the package at its current version, and returns the row to its idle state so it can be retried.

4. **FR-4 — One dialog, one implementation.** The Plugins page and the updates panel render the same component. A change to the wording or the identity shown lands on both.

5. **FR-5 — The row says it is personal.** A package from a personal source carries the `Personal` badge in the panel, as it does in the store and on the installed list.

6. **FR-6 — Other errors are unchanged.** Anything that is not the personal 409 keeps surfacing in the panel's error line.

## Acceptance criteria

- [x] Updating a personal package from the top-bar panel opens the fingerprint dialog instead of printing an error code.
- [x] Confirming calls the update again with `confirmed: true` and the fingerprint from the 409, and the row disappears.
- [x] Cancelling issues no further call and leaves the row updatable.
- [x] A non-personal package updates in one click, with no dialog.
- [x] The dialog renders above the panel (both are portaled) and is reachable on a phone.
- [x] The Plugins page behaves exactly as before.

## Edge cases

| Case                                                | Behaviour                                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Panel closed while the dialog is open               | Both close, nothing is sent. The update was never started.                                     |
| Confirmed update fails (fingerprint moved, network) | The panel's error line, as for any other failure (FR-6).                                       |
| Two personal packages behind                        | One dialog at a time: the panel already disables the other rows while one update is in flight. |
| Personal package whose source was removed           | Server-side failure, surfaced in the error line — removing a source stops updates by design.   |
