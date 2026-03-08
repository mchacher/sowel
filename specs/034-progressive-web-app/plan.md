# Implementation Plan: Progressive Web App

## Tasks

### Phase 1: PWA Core Setup

1. [x] Install `vite-plugin-pwa` in `ui/`
2. [x] Configure `vite-plugin-pwa` in `ui/vite.config.ts` (manifest, Workbox strategies)
3. [x] Generate app icons from `favicon.svg` (192x192, 512x512, 180x180, maskable)
4. [x] Add iOS meta tags to `ui/index.html` (`apple-mobile-web-app-capable`, `theme-color`, `apple-touch-icon`)
5. [x] Verify: PWA installable (Chrome DevTools > Application > Manifest)

### Phase 2: Offline Shell

6. [x] Create `ui/src/hooks/useOnlineStatus.ts` (online/offline detection)
7. [x] Create `ui/src/components/layout/OfflineBanner.tsx` (amber banner, auto-dismiss)
8. [x] Integrate `OfflineBanner` in `App.tsx`
9. [x] Add i18n keys for offline messages (fr + en)
10. [x] Verify: Chrome DevTools > Network > Offline → banner appears, uncheck → disappears

### Phase 3: Install Prompt

11. [x] Create `ui/src/hooks/usePwaInstall.ts` (beforeinstallprompt + display-mode detection)
12. [x] Create `ui/src/components/layout/InstallPrompt.tsx` (bottom banner with Install button)
13. [x] Integrate `InstallPrompt` in `App.tsx`
14. [x] Add i18n keys for install prompt (fr + en)

### Phase 4: QR Code Login

15. [x] Install `qrcode.react` in `ui/`
16. [x] Add `loginWithToken(token: string)` method to auth store (`ui/src/store/useAuth.ts`)
17. [x] Create `ui/src/pages/QrLoginPage.tsx` (read token from URL, validate, redirect)
18. [x] Add `/qr-login` route in `ui/src/App.tsx` (no sidebar layout)
19. [x] Create `ui/src/components/settings/MobileSection.tsx` (QR code generation UI)
20. [x] Integrate `MobileSection` in Settings page
21. [x] Add i18n keys for QR login (fr + en)
22. [x] Verify: generate QR on desktop → scan with phone → auto-login → dashboard

### Phase 5: Mobile Widget Adaptation

23. [x] Create `ui/src/hooks/useIsMobile.ts` (viewport < 640px, reactive via matchMedia)
24. [x] Create `ui/src/components/dashboard/BottomSheet.tsx` (generic animated container: backdrop, swipe-down, portal)
25. [x] Create `ui/src/components/dashboard/LightDetailSheet.tsx` (toggle + full-width horizontal brightness slider)
26. [x] Create `ui/src/components/dashboard/ShutterDetailSheet.tsx` (position slider + Open/Stop/Close buttons)
27. [x] Create `ui/src/components/dashboard/ThermostatDetailSheet.tsx` (current temp + large setpoint +/- + power)
28. [x] Create `ui/src/components/dashboard/HeaterDetailSheet.tsx` (mode selector + power toggle)
29. [x] Create `ui/src/components/dashboard/ZoneDetailSheet.tsx` (equipment list + grouped controls)
30. [x] Update `EquipmentWidget.tsx`: mobile mode → compact summary card (icon + state text, no inline controls)
31. [x] Update `ZoneWidget.tsx`: mobile mode → compact summary card
32. [x] Update `WidgetGrid.tsx`: pass `isMobile`, manage bottom sheet open/close state, card height `h-[160px]` on mobile
33. [x] Add i18n keys for bottom sheet (fr + en)
34. [x] Verify in Chrome DevTools: toggle device toolbar (responsive mode) → widgets switch between desktop/mobile layout

### Phase 6: Final Validation

35. [x] TypeScript compile check (backend + frontend, zero errors)
36. [x] Chrome DevTools responsive mode: test 375px (iPhone SE), 390px (iPhone 14), 412px (Pixel)
37. [x] Verify bottom sheets open/close smoothly, controls work
38. [x] Verify desktop UI is unchanged (no regressions)
39. [x] Verify "tap = action" widgets (light_onoff, switch, gate) toggle on tap in mobile mode
40. [x] Verify edit mode works on mobile (drag, rename, icon picker)
41. [x] Lighthouse PWA audit (basic criteria pass)
42. [x] Test QR login flow end-to-end
43. [x] Verify WebSocket reconnection after offline → online

## Dependencies

- Requires spec 033 Milestone A (dashboard widgets) — completed
- npm packages: `vite-plugin-pwa`, `qrcode.react`

## Testing

All testing can be done in **Chrome DevTools** with responsive/device emulation:

1. **PWA**: DevTools > Application > Manifest → verify manifest loaded
2. **Service Worker**: DevTools > Application > Service Workers → verify SW active
3. **Offline**: DevTools > Network > check "Offline" → banner appears
4. **Mobile layout**: DevTools > Toggle Device Toolbar (Ctrl+Shift+M) → set width < 640px
5. **Bottom sheets**: In mobile mode, tap a complex widget → sheet slides up
6. **QR login**: Settings > Mobile → generate QR → open URL in another tab to verify
7. **Install prompt**: DevTools > Application > Manifest → "Add to homescreen" link
8. **Desktop unchanged**: Switch back to desktop viewport → full widget controls render
