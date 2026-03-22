# Remote Access

Sowel can be accessed securely from outside your home network using a **Cloudflare Tunnel**. This approach requires no port forwarding and does not expose your local network.

## How it works

```
Your phone/laptop (HTTPS)
  --> Cloudflare Edge (SSL termination, DDoS protection)
    --> Cloudflare Tunnel (outbound connection from your server)
      --> localhost:3000 (Sowel backend serving API + UI)
```

The Cloudflare Tunnel creates an **outbound** connection from your home server to Cloudflare's edge network. This means:

- No incoming ports need to be opened on your router
- All traffic is encrypted with HTTPS
- Cloudflare provides DDoS protection
- The free Cloudflare plan (Zero Trust) is sufficient

## Prerequisites

- A **Cloudflare account** (free plan works)
- A **domain name** managed by Cloudflare DNS (you can register one through Cloudflare or transfer an existing domain)
- **cloudflared** installed on the machine running Sowel

## Setup

### Step 1: Install cloudflared

On macOS:

```bash
brew install cloudflared
```

On Linux (Debian/Ubuntu):

```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
```

### Step 2: Authenticate with Cloudflare

```bash
cloudflared tunnel login
```

This opens a browser window where you authorize cloudflared to access your Cloudflare account.

### Step 3: Create a tunnel

```bash
cloudflared tunnel create sowel
```

This creates a tunnel and generates a credentials file.

### Step 4: Configure the tunnel

Create a configuration file at `~/.cloudflared/config.yml`:

```yaml
tunnel: sowel
credentials-file: /path/to/credentials.json

ingress:
  - hostname: app.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

Replace `app.yourdomain.com` with your actual subdomain and update the credentials file path.

### Step 5: Create DNS records

```bash
cloudflared tunnel route dns sowel app.yourdomain.com
```

This creates a CNAME record in Cloudflare DNS pointing your subdomain to the tunnel.

### Step 6: Run the tunnel

For testing:

```bash
cloudflared tunnel run sowel
```

For production, install as a system service:

```bash
sudo cloudflared service install
```

This creates a system service (LaunchDaemon on macOS, systemd on Linux) that starts the tunnel automatically at boot.

## Management

### Check tunnel status

On macOS:

```bash
sudo launchctl list | grep cloudflare
```

On Linux:

```bash
sudo systemctl status cloudflared
```

### Restart the tunnel

On macOS:

```bash
sudo launchctl stop com.cloudflare.cloudflared
sudo launchctl start com.cloudflare.cloudflared
```

On Linux:

```bash
sudo systemctl restart cloudflared
```

### Uninstall the tunnel

```bash
sudo cloudflared service uninstall
```

### Cloudflare dashboard

Manage your tunnel from the Cloudflare web interface:

- **Zero Trust dashboard**: [https://one.dash.cloudflare.com](https://one.dash.cloudflare.com) -- tunnel status, access policies
- **DNS management**: Cloudflare dashboard > your domain > DNS -- verify records

## UI static files

The Sowel backend (Fastify on port 3000) serves the built UI from the `ui-dist/` directory. When you access Sowel remotely, you are using this pre-built version of the frontend.

### Rebuilding the UI for remote access

If you make changes to the UI and want them visible remotely:

```bash
cd ui && npm run build && cp -r dist ../ui-dist
```

!!! info
This is only needed when UI code changes. In local development, use `localhost:5173` (Vite dev server) for hot reload. The remote URL always serves the built version from `ui-dist/`.

## Local vs remote access

| Usage             | URL                          | Notes                               |
| ----------------- | ---------------------------- | ----------------------------------- |
| Local development | `http://localhost:5173`      | Vite dev server with hot reload     |
| Local production  | `http://localhost:3000`      | Backend serves built UI             |
| Remote access     | `https://app.yourdomain.com` | Cloudflare Tunnel to localhost:3000 |

## Security considerations

!!! warning
Make sure you use strong passwords for your Sowel admin account. Anyone with the remote URL can reach your login page.

- All remote traffic is encrypted (HTTPS via Cloudflare)
- Sowel's built-in JWT authentication protects all API endpoints
- Consider adding [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) policies for an additional layer of authentication (e.g., email-based one-time codes)
- API tokens can be created from Settings for external integrations that need programmatic access
