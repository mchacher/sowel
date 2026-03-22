# Remote Access — Cloudflare Tunnel

Sowel is accessible remotely via a Cloudflare Tunnel, without port forwarding or exposing the local network.

## Architecture

```
Browser (HTTPS)
  → Cloudflare Edge (SSL, DDoS protection)
    → Cloudflare Tunnel (outbound connection from local machine)
      → localhost:3000 (Sowel backend serving API + UI)
```

## Setup

| Component       | Value                                                       |
| --------------- | ----------------------------------------------------------- |
| Domain          | `sowel.org` (registered via Cloudflare)                     |
| Public URL      | `https://app.sowel.org`                                     |
| Tunnel name     | `sowel`                                                     |
| Tunnel target   | `http://localhost:3000`                                     |
| SSL mode        | Flexible (HTTPS browser→Cloudflare, HTTP Cloudflare→origin) |
| Cloudflare plan | Free (Zero Trust)                                           |
| Team name       | `sowel.cloudflareaccess.com`                                |

## Infrastructure

- **cloudflared** is installed as a system service on the host machine (macOS LaunchDaemon)
- The tunnel starts automatically at boot
- Service config: `/Library/LaunchDaemons/com.cloudflare.cloudflared.plist`

## Management

### Check tunnel status

```bash
sudo launchctl list | grep cloudflare
```

### Restart tunnel

```bash
sudo launchctl stop com.cloudflare.cloudflared
sudo launchctl start com.cloudflare.cloudflared
```

### Uninstall tunnel

```bash
sudo cloudflared service uninstall
```

### Cloudflare dashboard

- Zero Trust dashboard: https://one.dash.cloudflare.com
- Tunnel config: Networks → Connectors → sowel
- DNS records: https://dash.cloudflare.com → sowel.org → DNS

## UI Static Files

The backend (Fastify on port 3000) serves the built UI from `ui-dist/` at the project root.

### Rebuild UI for remote access

```bash
cd ui && npm run build && cp -r dist ../ui-dist
```

This is only needed when UI changes should be visible on `app.sowel.org`. In local dev, use `localhost:5173` (Vite dev server) for hot reload.

## Backend Changes

Two changes were made to support serving the UI from the backend:

1. **`src/api/server.ts`** — Fixed `ui-dist` path resolution to work with both `tsx` (dev) and compiled JS (prod)
2. **`src/auth/auth-middleware.ts`** — Skip authentication for non-API routes (static files) so the UI can load without a token

## Local Dev vs Remote Access

| Usage                  | URL                     | Setup                                     |
| ---------------------- | ----------------------- | ----------------------------------------- |
| Local dev (hot reload) | `http://localhost:5173` | `npm run dev` + `cd ui && npm run dev`    |
| Local prod preview     | `http://localhost:3000` | `npm run dev` (backend serves `ui-dist/`) |
| Remote access          | `https://app.sowel.org` | Cloudflare Tunnel → `localhost:3000`      |
