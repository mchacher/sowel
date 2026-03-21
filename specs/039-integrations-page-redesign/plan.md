# Implementation Plan: Integrations Page Redesign

## Tasks

### Backend

1. [ ] Add `deviceCount` and `offlineDeviceCount` to `IntegrationInfo` in `src/shared/types.ts`
2. [ ] Enrich `GET /api/v1/integrations` response with device counts (filter deviceManager by integrationId)
3. [ ] Add `POST /api/v1/integrations/:id/restart` endpoint (stop + start)

### Frontend Types & API

4. [ ] Update `IntegrationInfo` in `ui/src/types.ts`
5. [ ] Add `restartIntegration()` to `ui/src/api.ts`

### Frontend Components

6. [ ] Create `IntegrationRow.tsx` — compact row with icon, name, status badge, device count, poll countdown, quick action buttons
7. [ ] Create `IntegrationDrawer.tsx` — slide-out panel with stats, actions, config form
8. [ ] Rewrite `IntegrationsPage.tsx` — list layout + drawer state management
9. [ ] Mobile responsive: full-screen drawer, touch-friendly action buttons

### Validation

10. [ ] TypeScript compiles (backend + frontend, zero errors)
11. [ ] All tests pass
12. [ ] Manual verification: all 5 integrations visible, actions work, drawer opens/closes
13. [ ] Mobile verification via Playwright or browser devtools

## Testing

- Open /integrations, verify all 5 integrations listed with correct status
- Click Stop on a running integration → status changes to disconnected
- Click Start → status changes to connected
- Click Refresh on a polling integration → data refreshes
- Click row → drawer opens with config form
- Save settings in drawer → integration restarts
- Test on mobile viewport (375px width)
