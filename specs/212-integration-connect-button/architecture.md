# Spec 212 — Architecture

## Files

| File                                                   | Change                                                                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/api/routes/plugins.ts`                            | success redirect carries `&plugin=<id>` (URL-encoded)                                                                                                    |
| `ui/src/components/integrations/IntegrationDrawer.tsx` | `touched` / `triedSave` state; missing list; Start label; field marks; Save-and-connect                                                                  |
| `ui/src/pages/IntegrationsPage.tsx`                    | success message from the `plugin` query parameter and the loaded integration's name                                                                      |
| `ui/src/i18n/locales/en.json`, `fr.json`               | `oauthConnect`, `oauthSaveAndConnect`, `oauthSuccess`, `oauthSuccessGeneric`, `oauthFillFirst`, `missingFields`, `requiredField`; `fillRequired` removed |

No data model, no event, no new route.

## Drawer state

- `touched: Record<string, boolean>` is set on a field's blur.
- `triedSave: boolean` is set by Save and by Save-and-connect.
- `missing = settings.filter(required && !value.trim())`.
- A field is marked when it is in `missing` and (`touched[key]` or `triedSave`).
- Field ids are `integration-<pluginId>-<key>`: the "Missing" buttons focus them, and the error message is linked with `aria-describedby`.

## Save and connect

`handleSave` is split. `saveSettings()` holds the shared part: it skips the password mask, calls `updateSettings` and resets `dirty`. Save calls it, then restarts a connected integration. Connect calls it first when `dirty`, then `getPluginOAuthUrl`. There is no restart before an OAuth redirect: the plugin reads its settings when the callback arrives.
