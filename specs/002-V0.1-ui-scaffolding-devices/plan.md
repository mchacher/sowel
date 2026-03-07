# Implementation Plan: V0.1 UI Scaffolding + Devices Page

## Prerequisites

- V0.1 backend is running (`npm run dev`)
- Node.js 20+ installed

## Tasks

### Phase A: Scaffolding

1. [ ] Initialize Vite + React + TypeScript project in `ui/`
2. [ ] Install dependencies: tailwindcss, postcss, autoprefixer, zustand, react-router-dom, lucide-react
3. [ ] Configure Tailwind with Sowel design system tokens (colors, fonts, spacing, border-radius) — light mode only
4. [ ] Configure Vite proxy for `/api` and `/ws` to backend (localhost:3000)
5. [ ] Set up Inter + JetBrains Mono fonts (via @fontsource or CDN)
6. [ ] Create `ui/src/index.css` with Tailwind directives and base styles
7. [ ] Create `ui/src/types.ts` with frontend type definitions (mirroring backend types)

### Phase B: Core Infrastructure

8. [ ] Create `ui/src/api.ts` — fetch helpers for device endpoints
9. [ ] Create `ui/src/store/useDevices.ts` — Zustand device store
10. [ ] Create `ui/src/store/useWebSocket.ts` — Zustand WebSocket store with auto-reconnect and event dispatch

### Phase C: Layout

11. [ ] Create `ui/src/components/layout/Sidebar.tsx` — navigation with active state
12. [ ] Create `ui/src/components/layout/ConnectionStatus.tsx` — WS/MQTT indicator
13. [ ] Create `ui/src/components/layout/AppLayout.tsx` — shell with sidebar + header + Outlet
14. [ ] Create `ui/src/App.tsx` — React Router routes
15. [ ] Create `ui/src/main.tsx` — app entry point

### Phase D: Devices Pages

16. [ ] Create `ui/src/components/devices/DeviceCard.tsx` — summary card
17. [ ] Create `ui/src/components/devices/DeviceList.tsx` — grid of DeviceCards
18. [ ] Create `ui/src/pages/DevicesPage.tsx` — devices list route
19. [ ] Create `ui/src/components/devices/DeviceDataTable.tsx` — data values table
20. [ ] Create `ui/src/components/devices/DeviceNameEditor.tsx` — click-to-edit
21. [ ] Create `ui/src/pages/DeviceDetailPage.tsx` — full detail route

### Phase E: Validation

22. [ ] TypeScript compilation: `cd ui && npx tsc --noEmit` — zero errors
23. [ ] Verify with running backend: start backend + UI, check device list loads
24. [ ] Verify WebSocket: confirm real-time updates appear on data change
25. [ ] Verify device name edit: rename a device and confirm persistence

## Dependencies

- Requires V0.1 backend to be implemented (already done)
- No dependency on V0.2 or V0.3

## Testing Strategy

- Manual verification with a running zigbee2mqtt instance
- TypeScript strict mode serves as a first quality gate
- Unit tests for Zustand stores can be added later (not blocking for V0.1)
