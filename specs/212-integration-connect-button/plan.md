# Spec 212 — Plan

## Tasks

- [x] Callback redirect with `plugin` (+ route test)
- [x] i18n EN/FR keys
- [x] Drawer: missing list, Start label, field marks, Save-and-connect
- [x] Page: success message with the plugin name
- [x] Tests, validate, review, PR

## Test plan

| Module            | Scenario                           | Expected                                                                              |
| ----------------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| plugins route     | callback success                   | redirect `/settings/integrations?oauth_success=1&plugin=<id>`                         |
| IntegrationDrawer | OAuth plugin named Tesla           | button "Connect to Tesla"                                                             |
| IntegrationDrawer | required field empty               | Start reads "Start", disabled; "Missing: Domain"                                      |
| IntegrationDrawer | click the missing name             | the field has focus                                                                   |
| IntegrationDrawer | on open / after blur / after save  | unmarked / marked with `aria-invalid` and message                                     |
| IntegrationDrawer | optional empty field               | never listed or marked                                                                |
| IntegrationDrawer | dirty form, Connect                | label "Save and connect to Tesla"; `updateSettings` called before `getPluginOAuthUrl` |
| IntegrationDrawer | save fails during Save-and-connect | no OAuth URL request, error shown                                                     |
| IntegrationsPage  | `?oauth_success=1&plugin=tesla`    | "Tesla account connected."                                                            |
| IntegrationsPage  | `?oauth_success=1` alone           | "Account connected."                                                                  |
