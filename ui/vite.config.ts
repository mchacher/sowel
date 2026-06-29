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
            urlPattern: /^\/api\//,
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
  },
});
