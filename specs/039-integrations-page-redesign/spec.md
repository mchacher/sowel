# Integrations Page Redesign

## Summary

Redesign the integrations page from a grid of always-open config cards to a compact list view with at-a-glance status, quick actions (start/stop/refresh), and a slide-out detail panel for configuration.

## Acceptance Criteria

- [ ] List view shows all integrations with: icon, name, status badge, device count, poll countdown (if polling)
- [ ] Quick actions on each row: Stop (when connected), Start (when disconnected/error), Refresh (only for polling integrations, when connected)
- [ ] Clicking a row opens a slide-out drawer with: status stats, full action buttons, configuration form
- [ ] Configuration form in drawer supports text/password/number/boolean fields
- [ ] Save in drawer persists settings and restarts integration if connected
- [ ] Mobile/PWA compatible: single-column list, full-screen drawer on mobile
- [ ] Real-time status updates via WebSocket (integration status changes)

## Scope

### In Scope

- Compact list view with status + device count + poll countdown
- Quick action buttons (start/stop/refresh) on list rows
- Slide-out detail drawer with config form
- Backend: add deviceCount per integration to GET /api/v1/integrations
- Backend: add POST /api/v1/integrations/:id/restart endpoint
- Mobile-first responsive design

### Out of Scope

- Adding new integrations from the UI
- Integration logs/history in the detail panel (future)
- Drag-and-drop reordering

## Edge Cases

- Integration in "error" status: show Start button (to retry)
- Integration "not_configured": show "Configure" prompt, no start/stop, clicking opens drawer
- Poll countdown reaches 0: auto-refresh the integration data 3s later (existing behavior)
- Drawer open while status changes via WebSocket: drawer should update in real time
- Refresh button: disabled while refresh is in progress (loading spinner)
