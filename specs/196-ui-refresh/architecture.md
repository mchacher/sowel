# Architecture — Spec 196

UI-only refresh, except one additive backend field (FR-E). No migration, no new event, no new route.

## Layers touched

```
design-system/tokens.css        neutrals, roles, radii, dark base, type scale
        │
ui/src/index.css (@theme)       Tailwind tokens → utilities (text-*, rounded-*, colours, hit-44)
        │
ui/src/lib/format.ts            the only place numbers become strings
ui/src/lib/api-error.ts         ApiError + apiErrorMessage
        │
components / pages              consume tokens, format, PageHeader, SetpointStepper, useGuardedAction
        │
eslint.config (ui)              no toFixed in render, no arbitrary font size, no hex in charts
```

## New modules

### `ui/src/lib/format.ts`

```ts
type Locale = string; // i18n.language
formatNumber(v: number | null | undefined, opts?: { decimals?: number; maxDecimals?: number; locale?: Locale }): string
formatPower(w: number | null | undefined, opts?: { locale?: Locale }): string        // 745 W · 1,1 kW
formatEnergy(kwh: number | null | undefined, opts?: { locale?: Locale }): string     // 0,7 · 14,3 · 984 kWh (3 significant, ≤ 2 decimals)
formatTemperature(c: number | null | undefined, opts?: { style?: "compact" | "full"; locale?: Locale }): string // 20,5° · 20,5 °C (1 fixed decimal)
formatPercent(p: number | null | undefined, opts?: { decimals?: number; locale?: Locale }): string // 39 %
formatDuration(seconds: number | null | undefined, opts?: { locale?: Locale }): string // 35 s · 2 min 12 s · 1 h 05
formatWithUnit(v: number | null | undefined, unit: string, opts?): string            // rules per unit; unknown unit kept verbatim
```

`null`, `undefined`, `NaN` → `—`. In French, the module replaces the group separator by U+202F, inserts U+202F before the unit and uses U+2212 for negatives (`Intl.NumberFormat` does neither under Node 24).

### `ui/src/lib/api-error.ts`

`class ApiError extends Error { status: number }` thrown by `api/client.ts` (message unchanged), and `apiErrorMessage(err, t)` mapping 429, 404, network and 5xx to translated texts.

### `ui/src/components/layout/PageHeader.tsx`

`title`, `subtitle?`, `actions?`; `flex flex-wrap`, actions on their own row under 640 px.

### `ui/src/components/controls/SetpointStepper.tsx`

Props: `value`, `min`, `max`, `step`, `unit`, `size: "sm" | "lg"`, `commitDelayMs`, `onCommit(value)`, `pending?`. Local value moves on each tap; one `onCommit` after `commitDelayMs` of inactivity; `flush()` on unmount. `commitDelayMs` comes from `setpointCommitDelay(equipment)` (cloud integration ≈ 600 ms, local ≈ 150 ms).

### `ui/src/hooks/useGuardedAction.ts`

Wraps a gate actuation: if the equipment requires confirmation, opens the slide-to-confirm sheet (touch) or a two-button dialog (pointer: fine); texts from the current gate state.

## Tokens (`design-system/tokens.css`)

- Neutrals: brand-tinted scale (light background `#ECF2F7` family), dark ocean night (`#0E191F` page, `#17232B` surface); exact values in the PR.
- Roles: `--on` (amber), `--on-text #8A6100`, `--attention #E8730C`, `--attention-text #A85500`, `--fault #B42318`, `--ok #13794A`, dark counterparts; `--primary-fill` / `--primary-ink`, dark fill `#2B7299`.
- Radii: 6 / 10 / 16 + full.
- Type: `--text-micro 11`, `--text-caption 12`, `--text-small 13`, `--text-body 14`, `--text-lead 16`, `--text-title 20`, `--text-display 28`, `--text-value 40`.

## Backend (FR-E)

`src/api/routes/energy.ts`, by-usage series: add `colorIndex: number` next to `color` (same ordering rule). `ui` picks `--series-N` from it.

## Files changed (main ones)

| Slice | Files                                                                                                                                                                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1a/1b | `LogsPage`, `EquipmentsPage`, `DevicesPage`, `ZonesPage`, `EquipmentCard`, `SensorValues`, `IntegrationRow`, `EnergyBarChart`, `ProductionBarChart`, `DashboardPage`, `AppLayout`, `ZoneAggregationPills`, `index.css`, new `PageHeader`, new `lib/chart-ticks.ts` |
| 2a/2b | `i18n/locales/{fr,en}.json`, `index.html`, `ZoneDetailPage`, `api/client.ts`, new `lib/api-error.ts`, `EquipmentDetailPage`, `AnalyseView`, gate texts                                                                                                             |
| 3a/3b | new `lib/format.ts`, ≈ 45 components, `eslint.config`                                                                                                                                                                                                              |
| 5a/5b | `package.json` (ui), `index.css`, `design-system/tokens.{css,md}`, codemod over `ui/src`                                                                                                                                                                           |
| 4/4b  | `tokens.css`, `index.css`, ≈ 100 components, `WidgetIcons.tsx`, `AwningIcon.tsx`, `index.html`, `vite.config.ts`                                                                                                                                                   |
| 6     | `AppLayout`, `CurrentTimePill`, `ConnectionStatus`, `SunlightBanner`, `HeaderPill`, `DashboardPage`, H1 rule                                                                                                                                                       |
| 7a/7b | `tokens.css`, `index.css` (`@utility card`), radius codemod                                                                                                                                                                                                        |
| 8a/8b | new `SetpointStepper`, `ThermostatCard`, `WidgetDetailSheet`, `EquipmentWidget`, `EvChargerControl`, `mobile-click-action`, `MobileWidgetCard`                                                                                                                     |
| 9     | `EquipmentDetailPage` and type sections, breadcrumb, dashboard sheet footer                                                                                                                                                                                        |
| P     | new `useGuardedAction`, `GateControl`, `EquipmentWidget`, `ZoneCommands`, `specs/146` amendment note                                                                                                                                                               |
| E     | `submeterPalette.ts`, `history-utils.ts`, `EnergyPage`, `ProductionPage`, `LiveSubmeterBreakdown`, `src/api/routes/energy.ts`                                                                                                                                      |
