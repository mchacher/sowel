import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
        scope: "/",
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
        // Spec 127 — Web Push: pull in the push + notificationclick handlers
        // (the generated SW only does caching). File lives in public/.
        importScripts: ["push-handler.js"],
        // Default precache cap is 2 MiB; the main bundle crossed that with the
        // spec 114 rework + Recharts, so the build failed in CI. Raise the cap
        // to 5 MiB until we split the bundle (manualChunks) in a follow-up.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // A bare RegExp here is matched against the full request URL
            // (including origin), not just the pathname — `/^\/api\//`
            // never actually matched anything, since `url.href` always
            // starts with `http://…`, never `/api/`. Found 2026-08-04
            // investigating why camera HLS segment requests seemed to
            // bypass normal fetch handling on Android. A matcher function
            // is unambiguous: it receives the parsed URL and is tested
            // against `pathname` explicitly.
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
        ],
      },
      devOptions: {
        // Service worker disabled in dev — caching old bundles causes
        // hard-to-debug "my fix isn't taking effect" issues. PWA is still
        // built and tested in production builds.
        enabled: false,
      },
    }),
  ],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
    fs: {
      // Spec 150 — the UI imports the shared binding-candidates module from
      // ../src/shared (single implementation with the backend). The dev
      // server's default allow-list stops at ui/; setting `allow` replaces
      // the default, so ui/ itself must be re-listed. Scoped to ../src/shared
      // only (not the repo root) to avoid serving data/ or .env over /@fs/.
      allow: [".", "../src/shared"],
    },
  },
});
