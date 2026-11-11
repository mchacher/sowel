# Architecture — Spec 206

UI only.

| File                                              | Change                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| `ui/src/lib/settings-tab.ts` (+ test)             | `SettingsTab` gains `"solar"`; `initialSettingsTab` accepts it         |
| `ui/src/pages/SettingsPage.tsx`                   | tab `solar` (admin-only) with `SolarInstallationSettings`, `ArbiterSettings`; tab bar `overflow-x-auto`, `whitespace-nowrap`, scrollbar hidden, active tab `scrollIntoView({ inline: "nearest" })` on mount |
| `ui/src/components/energy/ProductionPage.tsx` (+ test) | link `?tab=solar`                                                 |
| `ui/src/components/equipments/PvForecastPanel.tsx` (+ test) | link `?tab=solar`                                            |
| `ui/src/i18n/locales/{en,fr}.json`                | `settings.tabs.solar`: « Solaire » / « Solar »                         |
| docs                                              | see the docs delta in `spec.md`                                        |

The scrollbar is hidden with Tailwind arbitrary variants (`[scrollbar-width:none]`,
`[&::-webkit-scrollbar]:hidden`), no CSS file. The cut-off last label is the cue that the bar scrolls.
