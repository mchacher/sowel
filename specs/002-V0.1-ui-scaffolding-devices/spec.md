# V0.1 UI: Scaffolding + Devices Page

## Summary

Add a React web UI to the existing V0.1 backend. The UI provides the React/Vite/Tailwind/Zustand scaffolding, a WebSocket connection to the engine for real-time updates, and a Devices page (list + detail) as the first user-facing screen.

This is part of the new incremental UI strategy: each backend version ships its corresponding UI pages rather than deferring all UI work to V0.4.

## Reference

- Spec sections: §4.2 (Frontend tech stack), §7.11 (WebSocket), §11 V0.4 (adapted), §15 (Design System), §16 (Frontend notes)

## Decisions

| Decision       | Choice          | Rationale                                                           |
| -------------- | --------------- | ------------------------------------------------------------------- |
| Auth           | None            | Auth module not yet implemented; open access for now                |
| Dark mode      | Deferred        | Will be added later; Tailwind config prepared with `class` strategy |
| Routing        | React Router v6 | URL-based navigation (/devices, /devices/:id), bookmarkable         |
| Device editing | Included        | User can rename a device from the UI (PUT /api/v1/devices/:id)      |

## Acceptance Criteria

- [ ] `ui/` directory contains a working React + Vite + TypeScript project
- [ ] Tailwind CSS configured with the Winch design system tokens (light mode)
- [ ] Zustand WebSocket store connects to `ws://host:port/ws` and dispatches events
- [ ] Zustand device store hydrates from `GET /api/v1/devices` on startup
- [ ] Device store updates in real-time from WebSocket events (device.discovered, device.removed, device.status_changed, device.data.updated)
- [ ] Devices list page at `/devices` shows all devices with: name, source, status (online/offline badge), category summary, last seen
- [ ] Device detail page at `/devices/:id` shows: device info, all DeviceData entries with live values, DeviceOrders list, raw expose data
- [ ] User can edit device name from the detail page (calls PUT /api/v1/devices/:id)
- [ ] Layout shell with sidebar navigation (placeholder links for future pages: Dashboard, Equipments, Zones, Scenarios)
- [ ] Responsive layout: works on mobile (< 640px) and desktop (> 1024px)
- [ ] Inter font loaded, design system typography applied
- [ ] Lucide React icons used consistently
- [ ] `cd ui && npx tsc --noEmit` compiles with zero errors
- [ ] Vite dev server runs and proxies API calls to backend

## Scope

### In Scope

- React + Vite + Tailwind + Zustand scaffolding
- React Router v6 with routes: `/` (redirect to /devices), `/devices`, `/devices/:id`
- WebSocket store with auto-reconnect
- Device Zustand store (hydrate from API + live updates from WS)
- Devices list page (table or card grid)
- Device detail page (data, orders, raw expose, name edit)
- App layout shell (sidebar + header + main content area)
- Tailwind config with design system color tokens (light mode only)
- Vite proxy config to forward `/api` and `/ws` to the backend
- Inter + JetBrains Mono font loading

### Out of Scope

- Dark mode (deferred — config prepared but no toggle)
- Authentication (no login, no JWT, no API tokens)
- Equipment pages (V0.2)
- Zone pages (V0.3)
- Dashboard (V0.3)
- Device delete from UI (dangerous action, not needed yet)
- WebSocket auth/recovery protocol (no auth module yet)
- Order execution from UI (no Equipment bindings yet — Orders are at Device level, execution will come in V0.2)
- Charts / history (V0.6)
- Notification toasts (V0.4 polish)

## Edge Cases

- **WebSocket disconnects**: Show a connection status indicator in the header. Auto-reconnect with exponential backoff.
- **API unreachable on startup**: Show a loading/error state on the Devices page. Retry button.
- **Device goes offline**: Update status badge in real-time via WebSocket event.
- **Empty state**: No devices discovered yet — show a friendly empty state message.
- **Device data with null values**: Display `—` in text-tertiary color per spec §15.
- **Device name edit fails**: Show inline error, revert to previous name.
- **Very long device list**: Pagination or virtual scroll not needed for V0.1 (typical home has < 100 devices).
