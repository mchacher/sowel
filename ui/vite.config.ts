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
