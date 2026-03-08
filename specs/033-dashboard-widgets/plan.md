# Implementation Plan: Dashboard Widgets

## Milestones Overview

| Milestone                  | Scope                                                  | Depends on |
| -------------------------- | ------------------------------------------------------ | ---------- |
| **A — Dashboard Widgets**  | DB, API, UI page, widget grid, edit mode, icon picker  | —          |
| **B — PWA & Mobile Login** | manifest, service worker, QR code login, offline shell | A          |

---

## Milestone A — Dashboard Widgets

### Phase 1: Backend (types, DB, API)

1. [x] Add `DashboardWidget`, `WidgetFamily` types to `src/shared/types.ts`
2. [x] Add `WIDGET_FAMILY_TYPES` constant to `src/shared/constants.ts`
3. [x] Create migration `migrations/031_dashboard_widgets.sql` (table with label, icon, family columns, ON DELETE CASCADE)
4. [x] Create `src/api/routes/dashboard.ts` with all endpoints:
   - GET `/api/v1/dashboard/widgets` (list ordered)
   - POST `/api/v1/dashboard/widgets` (create equipment or zone widget)
   - PATCH `/api/v1/dashboard/widgets/:id` (update label, icon)
   - DELETE `/api/v1/dashboard/widgets/:id` (remove)
   - PUT `/api/v1/dashboard/widgets/order` (batch reorder)
5. [x] Register routes in `src/api/server.ts`
6. [x] Verify: `npx tsc --noEmit` passes

### Phase 2: Frontend store & API

7. [x] Add `DashboardWidget`, `WidgetFamily` types to `ui/src/types.ts`
8. [x] Add dashboard API functions to `ui/src/api.ts` (list, create, update, delete, reorder)
9. [x] Create `ui/src/store/useDashboard.ts` (Zustand store: fetch, create, update, delete, reorder)
10. [x] Verify: `cd ui && npx tsc --noEmit` passes

### Phase 3: Dashboard page & widgets

11. [x] Create `ui/src/pages/DashboardPage.tsx` with responsive grid (2/3/4 cols)
12. [x] Create `ui/src/components/dashboard/EquipmentWidget.tsx` with per-type sub-components:
    - `LightOnOffEquipmentWidget`, `LightDimmableEquipmentWidget`, `ShutterEquipmentWidget`
    - `ThermostatEquipmentWidget`, `GateEquipmentWidget`, `HeaterEquipmentWidget`
    - `SwitchEquipmentWidget`, `SensorEquipmentWidget`, `ButtonEquipmentWidget`
13. [x] Create `ui/src/components/dashboard/ZoneWidget.tsx` with per-family sub-components:
    - `ZoneLightsWidget`, `ZoneShutterWidget`, `ZoneHeatingWidget`, `ZoneSensorsWidget`
14. [x] Create `ui/src/components/dashboard/WidgetGrid.tsx` (responsive CSS grid + drag & drop + edit overlays)
15. [x] Add `/dashboard` route to `ui/src/App.tsx`, redirect `/` to `/dashboard`
16. [x] Add "Dashboard" item to sidebar navigation (first position)
17. [x] Verify: widgets render correctly, real-time updates work

### Phase 4: Edit mode & configuration

18. [x] Add edit mode toggle (admin only) to dashboard header
19. [x] Create `ui/src/components/dashboard/AddWidgetModal.tsx` (Tab 1: equipment picker grouped by zone, Tab 2: zone + family picker)
20. [x] Install `@dnd-kit/core` + `@dnd-kit/sortable`, implement drag & drop reordering
21. [x] Add delete button (X corner) on widgets in edit mode
22. [x] Add inline label rename (tap label in edit mode → input with auto-focus/select, commit on blur/Enter, cancel on Escape)
23. [x] Create `ui/src/components/dashboard/widget-icons.ts` (custom SVG icon registry + Lucide fallback map + defaults)
24. [x] Create `ui/src/components/dashboard/IconPicker.tsx` (custom SVG icon picker, type-filtered, popover)
25. [x] Create `ui/src/components/dashboard/WidgetIcons.tsx` (11 custom SVG icon components at 96×96)
26. [x] Handle edge cases: deleted equipment/zone (CASCADE), empty state, no data

### Phase 5: Zone Heating Widget Enhancement

27. [x] Add zone orders to `EquipmentManager.ZONE_ORDERS`:

- `allThermostatsPowerOn` (types: thermostat, alias: power, value: true)
- `allThermostatsPowerOff` (types: thermostat, alias: power, value: false)
- `allThermostatsSetpoint` (types: thermostat, alias: setpoint, value: FROM_BODY)

28. [x] Enhance `ThermometerIcon` in `WidgetIcons.tsx`: add `level` prop (0–1) for mercury fill height
29. [x] Implement `ZoneHeatingWidget` in `ZoneWidget.tsx`:

- Horizontal layout: thermometer (mercury = setpoint level) + avg temperature + power button to the right
- Setpoint display with −/+ buttons (step 0.5°C, range 16–30°C)
- Call `executeZoneOrder` for `allThermostatsSetpoint` and `allThermostatsPowerOn/Off`

30. [x] Add i18n keys for heating controls (fr + en)

### Phase 6: UI Polish

31. [x] Horizontal widget layout with `grid-cols-[1fr_auto_1fr]` for centered icons
32. [x] Custom SVG icons at 96×96 with state-driven appearance
33. [x] Fixed card height `h-[240px]` with vertical centering (`my-auto`)
34. [x] Vertical slim slider for dimmable lights (`slider-slim` CSS class)
35. [x] Shutter "Ouvert"/"Fermé" labels at extremes (0%/100%)
36. [x] Thermostat: power button next to temperature, setpoint −/+ in bottom zone
37. [x] Gate icon variants: swing gate, sliding gate, garage door (selectable via icon picker)
38. [x] Add i18n keys for dashboard labels, icon picker (fr + en)

### Phase 7: Sensor icons enrichment

39. [ ] Replace `SensorWidgetIcon` (gauge) with `MultiSensorIcon` (box with signal waves) as default sensor icon
40. [ ] Add new sensor SVG icons to `WidgetIcons.tsx`:

- `MultiSensorIcon` — multi-sensor box with signal waves
- `HumiditySensorIcon` — water droplet with fill level
- `LuminositySensorIcon` — sun with radiating rays
- `WaterLeakSensorIcon` — droplet falling into puddle
- `SmokeSensorIcon` — round detector with smoke cloud
- `Co2SensorIcon` — cloud with CO₂ text
- `PressureSensorIcon` — barometer dial with needle

41. [ ] Register new icons in `CUSTOM_ICON_REGISTRY` (widget-icons.ts)
42. [ ] Update imports in `WidgetIcons.tsx` exports and `widget-icons.ts`
43. [ ] TypeScript compile check (zero errors)

### Phase 8: Final validation

44. [x] TypeScript compile check (backend + frontend, zero errors)
45. [ ] Mobile responsive testing (2-col grid, touch targets)
46. [ ] Dark mode verification
47. [ ] Manual test: add widgets, reorder, rename, change icon, delete, real-time updates
48. [ ] Manual test: zone heating widget — setpoint +/-, power on/off, mercury level updates
49. [ ] Verify PATCH API route for icon/label update works correctly

---

## Milestone B — PWA & Mobile Login (separate feature, spec TBD)

### Phase 1: PWA setup

1. [ ] Install `vite-plugin-pwa`
2. [ ] Create `manifest.json` (name, icons, theme, display: standalone)
3. [ ] Generate icons (192x192, 512x512, maskable)
4. [ ] Configure service worker strategy (cache-first assets, network-first API)
5. [ ] Add iOS meta tags (`apple-mobile-web-app-capable`, splash screens)

### Phase 2: QR code login

6. [ ] Backend: add endpoint `POST /api/v1/auth/qr-token` → generates short-lived token
7. [ ] Backend: add endpoint `POST /api/v1/auth/qr-login` → exchanges token for JWT session
8. [ ] UI: add "Connect Mobile" button in Settings → shows QR code (use `qrcode.react`)
9. [ ] UI: add `/qr-login/:token` route for mobile scanning
10. [ ] Auto-redirect to dashboard after QR login

### Phase 3: Offline & polish

11. [ ] Offline shell: show cached UI + "offline" banner when API unreachable
12. [ ] "Add to Home Screen" install prompt
13. [ ] Test on real devices (iOS Safari, Android Chrome)

---

## Dependencies

- Milestone A has no external dependencies (uses existing Sowel infrastructure)
- Milestone A requires npm packages: `@dnd-kit/core`, `@dnd-kit/sortable`
- Milestone B depends on Milestone A being complete
- Milestone B requires npm packages: `vite-plugin-pwa`, `qrcode.react`

## Testing

### Milestone A

- TypeScript compiles (zero errors, backend + frontend)
- Add 3-4 equipment widgets + 1 zone widget manually
- Verify real-time updates (toggle a light → widget updates)
- Verify reorder persists after page reload
- Verify responsive grid on mobile viewport (Chrome DevTools)
- Verify edit mode restricted to admin users
- Verify label rename and icon change persist
- Verify ON DELETE CASCADE (delete equipment → widget disappears)

### Milestone B

- Install PWA on iPhone + Android
- Scan QR code from desktop → mobile auto-logged in
- Kill server → PWA shows offline banner, cached UI still loads
- Restart server → PWA reconnects and resumes real-time updates
