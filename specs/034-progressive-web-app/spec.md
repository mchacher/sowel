# Progressive Web App (PWA)

## Summary

Transform the Sowel web UI into a Progressive Web App so users can install it on their mobile home screen and get a native-like experience. Includes service worker caching, app manifest, QR code login for easy mobile onboarding, and an offline shell.

## Reference

- sowel-spec.md §15 (Design System)
- sowel-webapp-v0.1.md §5 (WebApp / PWA)
- spec 033 Milestone B (original outline)

## Acceptance Criteria

- [x] `manifest.json` with app name "Sowel", icons, theme color `#1A4F6E`, `display: standalone`
- [x] App icons generated: 192x192, 512x512, and maskable variants
- [x] Service Worker via `vite-plugin-pwa` (Workbox):
  - Cache-first for static assets (JS, CSS, images, fonts)
  - Network-only for API calls (`/api/*`)
  - Stale-while-revalidate for the app shell (index.html)
- [x] iOS meta tags: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-touch-icon`
- [x] QR code login: admin generates a QR code in Settings containing an API token URL, mobile scans to authenticate
- [x] "Add to Home Screen" install prompt/banner
- [x] Offline shell: cached UI loads immediately, shows "Offline" banner when API is unreachable
- [x] WebSocket reconnection works after offline → online transition
- [x] PWA passes Lighthouse PWA audit (basic criteria)
- [x] Mobile widget interaction: simple widgets (toggle) act on tap, complex widgets open a bottom sheet with full controls
- [x] Desktop UI unchanged — bottom sheet is mobile-only

## Scope

### In Scope

- PWA manifest with icons and theme
- Service worker with Workbox strategies
- QR code generation UI (admin, in Settings > Mobile)
- QR code scan → auto-login flow
- Offline detection and banner
- iOS-specific meta tags and splash screen
- "Install app" prompt
- Mobile-adaptive widget interaction (bottom sheet for complex widgets)

### Out of Scope

- Push notifications (deferred to Sowel Connect / cloud tier)
- Native app wrappers (TWA / Bubblewrap for Play Store)
- Background sync
- Per-user offline data persistence
- Cloud tunnel (separate project)

## QR Code Login Flow

### How it works

1. Admin opens **Settings > Mobile** on desktop
2. Clicks "Generate QR code" → creates an API token via `POST /api/v1/me/tokens` with name "Mobile - {date}" and optional expiration
3. QR code encodes a URL: `http://<host>/qr-login?token=swl_xxxx`
4. User scans QR with phone camera → opens the URL in browser
5. `/qr-login` page reads the token from the URL query param
6. Stores the token in localStorage as the auth credential
7. Redirects to `/dashboard`
8. All subsequent API calls use `Authorization: Bearer swl_xxxx`

### Security considerations

- The token is a standard API token (same as existing system)
- Token can have an expiration date (configurable by admin)
- Token can be revoked from Settings > API Tokens
- QR code should be shown only once (or regenerated) — raw token visible only at creation
- The QR URL uses the current host, so it works both on LAN and via tunnel

### No new backend endpoints needed

The existing token system (`POST /api/v1/me/tokens`, `Bearer` auth middleware) already supports everything. The QR code login is purely a UI feature.

## Offline Shell

### Behavior

- When the app loads and the API is unreachable, the cached shell renders
- A banner appears at the top: "You are offline. Some features may be unavailable."
- The banner disappears when connectivity is restored
- WebSocket auto-reconnect already handles reconnection (existing behavior)
- No data mutation is possible offline (buttons disabled or hidden)

### Caching Strategy (Workbox)

| Resource       | Strategy               | Rationale                         |
| -------------- | ---------------------- | --------------------------------- |
| JS/CSS bundles | Cache-first (precache) | Versioned by Vite hash, immutable |
| Images/SVGs    | Cache-first            | Static assets                     |
| Fonts          | Cache-first            | Inter, JetBrains Mono             |
| `/index.html`  | Stale-while-revalidate | App shell, updated on deploy      |
| `/api/*`       | Network-only           | Live data, no caching             |
| `/ws`          | Excluded               | WebSocket, not cacheable          |

## App Icons

Based on the existing favicon.svg (ocean blue rounded square with concentric circles), generate:

| Size     | File                           | Usage                                |
| -------- | ------------------------------ | ------------------------------------ |
| 192x192  | `pwa-192x192.png`              | Android home screen                  |
| 512x512  | `pwa-512x512.png`              | Android splash screen                |
| 180x180  | `apple-touch-icon-180x180.png` | iOS home screen                      |
| maskable | `pwa-maskable-512x512.png`     | Android adaptive icon (with padding) |

## Edge Cases

- User on iOS < 16.4: PWA install works but no push notifications (acceptable, push is out of scope)
- User clears browser cache: service worker re-downloads assets on next visit
- Multiple tabs: only one service worker instance active (Workbox default)
- Token expired: QR-login page shows "Token expired, please generate a new QR code"
- API returns 401 during QR login: show error message, don't redirect
- Offline → online: WebSocket reconnects, stores re-fetch data (existing behavior)

## UI/UX

### Settings > Mobile (new section)

- Section title: "Application mobile"
- Description: "Scannez le QR code depuis votre téléphone pour installer Sowel"
- "Generate QR Code" button
- QR code display (large, centered)
- Token expiration selector: "7 days", "30 days", "Never"
- "Regenerate" button to create a new token/QR
- Instructions: "1. Scan the QR code 2. Add to home screen 3. Done!"

### QR Login Page (`/qr-login`)

- Minimal page, no sidebar
- Shows Sowel logo + "Connecting..." spinner
- On success: redirect to `/dashboard`
- On error: "Invalid or expired token" message with "Go to login" link

### Install Prompt

- Use `beforeinstallprompt` event (Chrome/Edge)
- Show a subtle banner at the bottom: "Install Sowel for a better experience" with "Install" button
- Dismiss on install or on "Not now"
- Don't show if already installed (check `display-mode: standalone`)

### Offline Banner

- Fixed position at the top, below the header
- Yellow/amber background: `bg-accent/10 text-accent`
- Text: "You are offline" / "Vous êtes hors ligne"
- Auto-dismiss when back online

## Mobile Widget Interaction (bottom sheet)

Desktop UI is unchanged. On mobile only, complex widgets open a **bottom sheet** on tap instead of showing inline controls.

### Detection

Mobile mode is detected via viewport width (`< 640px`), matching the existing Tailwind `sm:` breakpoint. This works in Chrome DevTools device emulation for testing.

### Widget categories

#### "Tap = action" widgets (no bottom sheet)

These widgets perform their action directly on tap, same as desktop:

| Widget        | Tap action            |
| ------------- | --------------------- |
| `light_onoff` | Toggle ON/OFF         |
| `switch`      | Toggle ON/OFF         |
| `gate`        | Toggle open/close     |
| `button`      | Read-only (no action) |
| `sensor`      | Read-only (no action) |

#### "Tap = open detail" widgets (bottom sheet)

These widgets show a simplified card in the grid. Tap opens a bottom sheet with full controls:

| Widget           | Card summary          | Bottom sheet content                                                    |
| ---------------- | --------------------- | ----------------------------------------------------------------------- |
| `light_dimmable` | Icon + "75%" + ON dot | Toggle + horizontal brightness slider                                   |
| `light_color`    | Icon + "75%" + ON dot | Toggle + horizontal brightness slider                                   |
| `shutter`        | Icon + "Ouvert"/"45%" | Horizontal position slider + Open/Stop/Close buttons                    |
| `thermostat`     | Icon + "21.5°C"       | Current temp + large setpoint +/- + power ON/OFF                        |
| `heater`         | Icon + mode label     | Mode selector full width + power toggle                                 |
| Zone lights      | Icon + "3/5 ON"       | Equipment list with individual toggles + All ON/OFF + brightness slider |
| Zone shutters    | Icon + "%"/"Mixte"    | Equipment list + slider + All Open/Close                                |
| Zone heating     | Icon + "21°C"         | Thermometer + setpoint +/- + power + thermostat list                    |
| Zone sensors     | Icon + primary value  | Full sensor values list                                                 |

### Mobile card layout (simplified)

On mobile, cards for "tap = open detail" widgets show a compact summary without inline controls:

```
┌────────────────┐
│   Spots Salon  │  ← Label
│                │
│    [Ampoule]   │  ← Icon (centered, state-driven)
│                │
│     75%  ●     │  ← State summary + ON indicator
└────────────────┘
```

- Card height on mobile: `h-[160px]` (vs `h-[240px]` on desktop)
- No inline slider, no +/- buttons, no bottom button zone
- Tap anywhere on the card = open bottom sheet

### Bottom sheet design

```
┌─────────────────────────────┐
│                             │
│         ── ──               │  ← Drag handle (pill shape)
│                             │
│        [Icon 96×96]         │
│        Spots Salon          │  ← Label
│                             │
│   ○──────────────●──── 75%  │  ← Full-width horizontal slider
│                             │
│    ┌─────────┐ ┌─────────┐  │
│    │   OFF   │ │   ON    │  │  ← Large touch-friendly buttons (h-12)
│    └─────────┘ └─────────┘  │
│                             │
└─────────────────────────────┘
```

- **Height**: ~50% of viewport (`max-h-[50vh]`), content-adaptive
- **Backdrop**: semi-transparent dark overlay, tap to close
- **Close**: tap backdrop, swipe down, or X button
- **Animation**: slide up from bottom (CSS transform + transition)
- **Controls**: all touch targets minimum 48px, sliders full-width
- **Real-time**: bottom sheet reflects live data updates (WebSocket)

### Edge cases

- Bottom sheet open + device goes offline → sheet stays open, controls disabled
- Bottom sheet open + widget deleted (by another admin) → sheet auto-closes
- Rotate device while sheet open → sheet adapts to new viewport
- Edit mode on mobile → same as desktop (drag handle, palette, delete, rename) — no bottom sheet in edit mode
