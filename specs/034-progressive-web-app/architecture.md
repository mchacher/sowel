# Architecture: Progressive Web App

## Data Model Changes

No database changes needed. The existing `api_tokens` table and auth system handle QR code login.

## New npm Packages

| Package           | Purpose                                      | Location |
| ----------------- | -------------------------------------------- | -------- |
| `vite-plugin-pwa` | Workbox service worker + manifest generation | `ui/`    |
| `qrcode.react`    | QR code React component                      | `ui/`    |

## File Changes

### New files

| File                                                    | Description                                    |
| ------------------------------------------------------- | ---------------------------------------------- |
| `ui/public/pwa-192x192.png`                             | App icon 192x192                               |
| `ui/public/pwa-512x512.png`                             | App icon 512x512                               |
| `ui/public/apple-touch-icon-180x180.png`                | iOS icon                                       |
| `ui/public/pwa-maskable-512x512.png`                    | Maskable icon (Android adaptive)               |
| `ui/src/pages/QrLoginPage.tsx`                          | QR code auto-login page                        |
| `ui/src/components/settings/MobileSection.tsx`          | QR code generation UI in Settings              |
| `ui/src/components/layout/OfflineBanner.tsx`            | Offline detection banner                       |
| `ui/src/components/layout/InstallPrompt.tsx`            | PWA install prompt banner                      |
| `ui/src/hooks/useOnlineStatus.ts`                       | Online/offline detection hook                  |
| `ui/src/hooks/usePwaInstall.ts`                         | PWA install prompt hook                        |
| `ui/src/hooks/useIsMobile.ts`                           | Viewport-based mobile detection (`< 640px`)    |
| `ui/src/components/dashboard/BottomSheet.tsx`           | Generic animated bottom sheet container        |
| `ui/src/components/dashboard/LightDetailSheet.tsx`      | Bottom sheet content for dimmable/color lights |
| `ui/src/components/dashboard/ShutterDetailSheet.tsx`    | Bottom sheet content for shutters              |
| `ui/src/components/dashboard/ThermostatDetailSheet.tsx` | Bottom sheet content for thermostats           |
| `ui/src/components/dashboard/HeaterDetailSheet.tsx`     | Bottom sheet content for heaters               |
| `ui/src/components/dashboard/ZoneDetailSheet.tsx`       | Bottom sheet content for zone widgets          |

### Modified files

| File                                              | Change                                                   |
| ------------------------------------------------- | -------------------------------------------------------- |
| `ui/vite.config.ts`                               | Add `vite-plugin-pwa` plugin with Workbox config         |
| `ui/index.html`                                   | Add iOS meta tags, theme-color, apple-touch-icon         |
| `ui/src/App.tsx`                                  | Add `/qr-login` route, add OfflineBanner + InstallPrompt |
| `ui/src/pages/SettingsPage.tsx`                   | Add "Mobile" section with QR code generation             |
| `ui/src/components/dashboard/WidgetGrid.tsx`      | Mobile: simplified cards, tap → open bottom sheet        |
| `ui/src/components/dashboard/EquipmentWidget.tsx` | Mobile: compact summary mode (no inline controls)        |
| `ui/src/components/dashboard/ZoneWidget.tsx`      | Mobile: compact summary mode                             |
| `ui/src/i18n/locales/fr.json`                     | Add PWA-related i18n keys                                |
| `ui/src/i18n/locales/en.json`                     | Add PWA-related i18n keys                                |

## Vite PWA Configuration

```typescript
// ui/vite.config.ts
import { VitePWA } from "vite-plugin-pwa";

VitePWA({
  registerType: "autoUpdate",
  includeAssets: ["favicon.svg", "apple-touch-icon-180x180.png"],
  manifest: {
    name: "Sowel",
    short_name: "Sowel",
    description: "Home automation — So well",
    theme_color: "#1A4F6E",
    background_color: "#F8F9FA",
    display: "standalone",
    orientation: "portrait",
    start_url: "/dashboard",
    icons: [
      { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
      { src: "pwa-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  },
  workbox: {
    navigateFallback: "/index.html",
    navigateFallbackDenylist: [/^\/api\//],
    runtimeCaching: [
      {
        urlPattern: /^\/api\//,
        handler: "NetworkOnly",
      },
    ],
  },
});
```

## QR Login Flow (sequence)

```
Desktop (admin)                    Mobile (user)
      │                                 │
      │ POST /api/v1/me/tokens          │
      │ { name: "Mobile", expiresAt }   │
      │ ────────────────────────►        │
      │ ◄──── { token: "swl_xxx" }      │
      │                                 │
      │ Show QR code encoding:          │
      │ http://<host>/qr-login?token=swl_xxx
      │                                 │
      │                  Scan QR ───────│
      │                                 │
      │                  GET /qr-login?token=swl_xxx
      │                                 │
      │                  Store token in localStorage
      │                  Redirect to /dashboard
      │                                 │
      │                  All API calls: │
      │                  Authorization: Bearer swl_xxx
```

## Auth Integration

The QR login page does NOT go through the normal login flow. It:

1. Reads `token` from URL query params
2. Validates the token by calling `GET /api/v1/me` with `Authorization: Bearer <token>`
3. If valid: stores token in localStorage (same key as JWT auth), redirects to `/dashboard`
4. If invalid (401): shows error message

The existing auth store (`useAuth`) needs a `loginWithToken(token: string)` method that:

- Stores the API token
- Fetches user info via `GET /api/v1/me`
- Sets the authenticated state

## Online/Offline Detection

```typescript
// useOnlineStatus.ts
function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}
```

## PWA Install Prompt

```typescript
// usePwaInstall.ts
function usePwaInstall() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(
    window.matchMedia("(display-mode: standalone)").matches,
  );
  // Listen for beforeinstallprompt event
  // Return { canInstall, install() }
}
```

## Component Architecture

```
App.tsx
├── OfflineBanner (fixed top, conditional)
├── InstallPrompt (fixed bottom, conditional)
├── Router
│   ├── /qr-login → QrLoginPage (no sidebar)
│   ├── /dashboard → DashboardPage
│   │   └── WidgetGrid
│   │       ├── WidgetRenderer (desktop: full controls, mobile: summary card)
│   │       └── BottomSheet (mobile only, opened on tap)
│   │           ├── LightDetailSheet
│   │           ├── ShutterDetailSheet
│   │           ├── ThermostatDetailSheet
│   │           ├── HeaterDetailSheet
│   │           └── ZoneDetailSheet
│   ├── /settings → SettingsPage
│   │   └── MobileSection (QR code generation)
│   └── ...existing routes
```

## Mobile Widget Architecture

### Detection strategy

```typescript
// useIsMobile.ts — reactive viewport detection
function useIsMobile(): boolean {
  // Uses window.matchMedia("(max-width: 639px)")
  // Reactive: updates on resize / orientation change
  // Works with Chrome DevTools device emulation
}
```

### Widget rendering (mobile vs desktop)

```
WidgetGrid receives isMobile from useIsMobile()
  │
  ├─ Desktop (isMobile = false)
  │   └─ WidgetRenderer → full card with inline controls (unchanged)
  │
  └─ Mobile (isMobile = true)
      ├─ "tap = action" widgets → same card, tap = action
      └─ "tap = detail" widgets → compact card, tap = open BottomSheet
```

### BottomSheet component

Generic container, reusable. Props:

```typescript
interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}
```

Features:

- CSS transform animation (translateY: 100% → 0)
- Backdrop click to close
- Swipe-down gesture to close (touch events)
- Portal rendered (createPortal to document.body)
- Max height 50vh, scrollable content
- Receives live data updates while open (no snapshot)

### Detail sheet pattern

Each detail sheet reuses the existing control components (toggle, slider, buttons) but with mobile-friendly sizing:

- Sliders: full-width horizontal, height 48px touch target
- Buttons: full-width or 50/50, height 48px
- Temperature display: large font (32px)
- Setpoint +/-: large buttons (56×56px)

No new control logic — the sheets compose existing `onExecuteOrder` callbacks.
