# Architecture — Spec 172

## What moves

`PersonalConfirmModal` and its `IdentityRow`, plus the `PersonalBadge`, were private to
`PluginsPage.tsx` (~120 lines near the bottom of a 1000-line page). They move, unchanged, to:

```
ui/src/components/plugins/PersonalConfirm.tsx
  export interface PersonalConfirmInfo { repo, owner, version, sha256 }
  export function PersonalConfirmModal({ info, mode, busy, onCancel, onConfirm })
  export function PersonalBadge()
```

`PluginsPage` imports them and loses the definitions; nothing about its behaviour changes. The modal
keeps its `createPortal` to `document.body` at `z-[60]`: it is raised above a portaled sheet on both
surfaces now, which is exactly why it was written that way (issue #749 test asserts it).

## What changes

`UpdatesSheet.handlePluginUpdate` grows the branch the Plugins page has had since spec 136:

```
updatePlugin(id)
  ├─ ok            → settle 1.5 s, refresh badge, drop the row      (unchanged)
  ├─ 409 personal  → keep the row spinning, open the dialog          (new)
  │                   ├─ confirm → updatePlugin(id, { confirmed: true, expectedSha256 }) → as "ok"
  │                   └─ cancel  → clear the dialog and the spinner, nothing sent
  └─ other error   → error line                                      (unchanged)
```

State: one more `useState`, `pending: { id, info } | null`. The row id travels with the info because
the retry targets a package id while the dialog shows a repository.

`updatePlugin(id, opts)` already takes `{ confirmed, expectedSha256 }` and already throws
`PersonalPluginConfirmationRequiredError` — the API client needs nothing. The server needs nothing:
`POST /plugins/:id/update` has answered this 409 since spec 136.

The sheet resets `pending` when it closes, next to the `error` / `updatingId` / `plugins` resets it
already does on `open`. The dialog lives inside the sheet's children: closing the sheet unmounts it,
which is the intended behaviour — an update that was never confirmed was never started.

## Why not the other options

- **Trust the source once and stop asking.** That is the guarantee, not the friction: the fingerprint
  is pinned per version precisely so new content cannot arrive unseen. Spec 136 is explicit.
- **Send the user to the Plugins page with a link.** It is the current behaviour minus the error
  code — two navigations to press a button that is already on screen.
- **Let the panel skip personal packages** (what `UpdateAllBanner` does for the bulk button). The
  banner acts on many packages at once and cannot show one dialog per package; the panel acts on one
  row at a time, which is exactly the shape a fingerprint confirmation needs.

## Files

| File                                             | Change                                                      |
| ------------------------------------------------ | ----------------------------------------------------------- |
| `ui/src/components/plugins/PersonalConfirm.tsx`  | new — modal + badge, moved verbatim                         |
| `ui/src/pages/PluginsPage.tsx`                   | imports them, definitions removed                           |
| `ui/src/components/layout/UpdatesSheet.tsx`      | the 409 branch, the dialog, the `Personal` badge on the row |
| `ui/src/components/layout/UpdatesSheet.test.tsx` | new — the four cases of the confirmation flow               |
| `docs/user/plugins{,.fr}.md`                     | the dialog appears wherever the update is started           |
