# Spec 212 — The integration Connect button names the plugin and the missing field

- **Status**: Implemented, mock-up approved by Adrien on 2026-11-17 (`maquette.html`, both arbitrations at their recommended value)
- **Scope**: UI (`IntegrationDrawer`, `IntegrationsPage`), the plugin OAuth callback redirect, i18n EN/FR
- **Related**: spec 039 (integrations page), the OAuth hooks of `IntegrationPlugin` (`getOAuthUrl`, `handleOAuthCallback`)

## Problem

Seen on 2026-11-17 while setting up a second OAuth plugin, `sowel-plugin-tesla`.

1. **The OAuth button says "Connect with Samsung" for every plugin.** The label dates from SmartThings, the only OAuth plugin until then. The success message also says "Samsung account connected".
2. **"Start" turns into "Fill required fields" without saying which field.** The user had pasted the domain into the wrong field. Both buttons stayed greyed out, and nothing on the screen named the empty field. The hint under Connect ("Fill in the credentials above before connecting") does not name it either.
3. **Connect ignores unsaved edits.** The authorization URL is built from the saved settings, so typing a value and clicking Connect without saving signs in with the old values.

## Goals

- The OAuth button and the success message name the plugin: "Connect to Tesla", "Tesla account connected."
- "Start" keeps its name. When required fields are empty, the drawer names them under the action buttons, and each name focuses its field.
- An empty required field is marked with an error border and the message "Required to start and connect". The mark appears once the field has been left or the form saved, never on opening the drawer (arbitration A2).
- With unsaved edits and no missing field, the button reads "Save and connect to Tesla", saves, then opens the provider (arbitration A1).

## Non-goals

- Plugin-specific validation (formats, ids). A plugin checks its own values and raises an alarm. The settings schema has no validation field, and adding one is a different feature.
- The layout of the drawer, its status cards, its Save button.

## Functional rules

- **R1** `integrations.oauthConnect` takes `{{name}}`, the integration's `name`. The same applies to `integrations.oauthSaveAndConnect` and `integrations.oauthSuccess`.
- **R2** `GET /api/v1/plugins/:id/oauth/callback` redirects on success to `/settings/integrations?oauth_success=1&plugin=<id>`. The page words its message with that integration's name, and with a generic "Account connected." when the id is unknown.
- **R3** The Start button is disabled while a required field is empty, and its label stays "Start". The key `integrations.fillRequired` is removed.
- **R4** Under the action buttons: "Missing: A, B." Each name is a button that focuses its field.
- **R5** A required field that is empty and either left (blur) or saved gets `aria-invalid`, an error border and the message "Required to start and connect", linked with `aria-describedby`.
- **R6** The hint under a disabled Connect names the missing fields: "Fill in first: A, B."
- **R7** On a plugin that is not connected yet, Connect while the form is dirty (no required field missing) saves the settings (`updateSettings`), refreshes the list, then requests the authorization URL. A failed save shows its error and does not navigate. On a connected plugin, "Reconnect" never saves: unsaved edits go through Save, which also restarts the plugin (review: an incomplete form must not be written by a reconnect).
- **R8** The drawer's marks survive a reload of the same integration (the list hands a new object after each save); they reset only when another integration is opened.

## Acceptance criteria

- [x] The drawer of an OAuth plugin named Tesla shows "Connect to Tesla"; SmartThings shows "Connect to SmartThings".
- [x] With the domain empty, Start reads "Start" and is disabled. "Missing: Domain" is shown, and clicking "Domain" focuses the field.
- [x] The empty field is marked only after a blur or a save.
- [x] A dirty form shows "Save and connect to Tesla". Clicking it saves before requesting the URL.
- [x] After the provider redirect, the page says "Tesla account connected."

## Edge cases

| Case                                 | Behaviour                                                 |
| ------------------------------------ | --------------------------------------------------------- |
| Optional field empty                 | never marked, never listed                                |
| Password field kept as the mask      | counts as filled (it is saved server-side)                |
| Save fails during "Save and connect" | error message, no navigation                              |
| Callback without `plugin` (old link) | generic "Account connected."                              |
| Plugin without OAuth                 | no Connect section, unchanged; R3–R5 still apply to Start |

## Docs delta

`Docs-Impact: none — the user docs never described the Connect button or its labels; the change is UI wording and inline validation only (docs/user/plugins*.md mention integrations without the drawer's buttons).`
