# Implementation Plan: Dashboard Widgets

## Milestones Overview

| Milestone                  | Scope                                                  | Depends on |
| -------------------------- | ------------------------------------------------------ | ---------- |
| **A — Dashboard Widgets**  | DB, API, UI page, widget grid, edit mode, icon picker  | —          |
| **B — PWA & Mobile Login** | manifest, service worker, QR code login, offline shell | A          |

---

## Milestone A — Dashboard Widgets

### Phase 1: Backend (types, DB, API)

1. [ ] Add `DashboardWidget`, `WidgetFamily` types to `src/shared/types.ts`
2. [ ] Add `WIDGET_FAMILY_TYPES` constant to `src/shared/constants.ts`
3. [ ] Create migration `migrations/031_dashboard_widgets.sql` (table with label, icon, family columns, ON DELETE CASCADE)
4. [ ] Create `src/api/routes/dashboard.ts` with all endpoints:
   - GET `/api/v1/dashboard/widgets` (list ordered)
   - POST `/api/v1/dashboard/widgets` (create equipment or zone widget)
   - PATCH `/api/v1/dashboard/widgets/:id` (update label, icon)
   - DELETE `/api/v1/dashboard/widgets/:id` (remove)
   - PUT `/api/v1/dashboard/widgets/order` (batch reorder)
5. [ ] Register routes in `src/api/server.ts`
6. [ ] Verify: `npx tsc --noEmit` passes

### Phase 2: Frontend store & API

7. [ ] Add `DashboardWidget`, `WidgetFamily` types to `ui/src/types.ts`
8. [ ] Add dashboard API functions to `ui/src/api.ts` (list, create, update, delete, reorder)
9. [ ] Create `ui/src/store/useDashboard.ts` (Zustand store: fetch, create, update, delete, reorder)
10. [ ] Verify: `cd ui && npx tsc --noEmit` passes

### Phase 3: Dashboard page & widgets

11. [ ] Create `ui/src/pages/DashboardPage.tsx` with responsive grid (2/3/4 cols)
12. [ ] Create `ui/src/components/dashboard/EquipmentWidget.tsx` (reuses LightControl, ShutterControl, etc.)
13. [ ] Create `ui/src/components/dashboard/ZoneWidget.tsx` (equipment list by family + grouped actions)
14. [ ] Create `ui/src/components/dashboard/WidgetGrid.tsx` (responsive CSS grid container)
15. [ ] Add `/dashboard` route to `ui/src/App.tsx`, redirect `/` to `/dashboard`
16. [ ] Add "Dashboard" item to sidebar navigation (first position)
17. [ ] Verify: widgets render correctly, real-time updates work

### Phase 4: Edit mode & configuration

18. [ ] Add edit mode toggle (admin only) to dashboard header
19. [ ] Create `ui/src/components/dashboard/AddWidgetModal.tsx` (Tab 1: equipment picker grouped by zone, Tab 2: zone + family picker)
20. [ ] Install `@dnd-kit/core` + `@dnd-kit/sortable`, implement drag & drop reordering
21. [ ] Add delete button (X corner) on widgets in edit mode
22. [ ] Add inline label rename (tap label in edit mode)
23. [ ] Create `ui/src/components/dashboard/widget-icons.ts` (curated ~40 icons list + default icon mapping)
24. [ ] Create `ui/src/components/dashboard/IconPicker.tsx` (popover with icon grid, updates via PATCH)
25. [ ] Handle edge cases: deleted equipment/zone (CASCADE), empty state, no data

### Phase 5: Polish & test

26. [ ] Add i18n keys for dashboard labels (fr + en)
27. [ ] Mobile responsive testing (2-col grid, touch targets ≥ 44x44px)
28. [ ] Dark mode verification
29. [ ] TypeScript compile check (backend + frontend, zero errors)
30. [ ] Manual test: add widgets, reorder, rename, change icon, delete, real-time updates

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
