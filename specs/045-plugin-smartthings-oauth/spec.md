# Plugin Update: SmartThings OAuth 2.0

## Summary

Replace PAT-based authentication in the SmartThings plugin with OAuth 2.0 Authorization Code flow.
Samsung broke PATs on December 30, 2024 — newly created PATs now expire after 24 hours.
This update is designed to be distributable: each Sowel user creates their own SmartThings OAuth app
and configures their credentials. After the one-time setup, tokens are auto-renewed forever.

## Context

- **Root cause**: Samsung PAT expiry policy change (Dec 30 2024) — all new PATs expire in 24h
- **Design**: Distributable — each user provides their own OAuth app credentials
- **Redirect URI**: User-configured (their Sowel instance URL + `/api/v1/plugins/smartthings/oauth/callback`)

## Acceptance Criteria

- [ ] User configures client_id, client_secret, redirect_uri in Sowel settings
- [ ] "Connecter avec Samsung" button appears once credentials are configured
- [ ] Clicking it opens Samsung's authorization page in the browser
- [ ] After authorization, Sowel receives the code and exchanges for access_token + refresh_token
- [ ] access_token auto-refreshed before expiry (every 20h, expires in 24h)
- [ ] refresh_token persisted in SQLite via settingsManager
- [ ] Integration shows "connected" after auth, "error" if refresh fails with re-auth button
- [ ] PAT field removed from plugin settings
- [ ] No user action required after initial authorization

## Scope

### In Scope

- OAuth 2.0 Authorization Code flow in the plugin
- New Sowel core endpoints for OAuth callback and URL
- New optional plugin interface methods: `getOAuthUrl()` and `handleOAuthCallback()`
- "Connecter avec Samsung" button in integration settings UI
- Auto-refresh logic (every 20h background timer)
- Plugin bumped to v0.5.0
- Documentation update: how to create a SmartThings OAuth app

### Out of Scope

- Generic OAuth framework for all plugins (SmartThings only for now)
- CSRF state validation (acceptable risk for self-hosted)
- Multiple SmartThings accounts per Sowel instance

## Plugin Settings Schema

| Key                | Label                      | Type     | Required | Notes                                                                   |
| ------------------ | -------------------------- | -------- | -------- | ----------------------------------------------------------------------- |
| `client_id`        | OAuth Client ID            | text     | yes      | From SmartThings developer portal                                       |
| `client_secret`    | OAuth Client Secret        | password | yes      | From SmartThings developer portal                                       |
| `redirect_uri`     | Redirect URI               | text     | yes      | e.g. `https://your-sowel.org/api/v1/plugins/smartthings/oauth/callback` |
| `polling_interval` | Polling interval (seconds) | number   | no       | Default 300, min 60                                                     |

## OAuth Flow

```
Setup (once):
  User creates OAuth app at developer.smartthings.com → gets client_id + client_secret
  User enters client_id, client_secret, redirect_uri in Sowel
  User registers same redirect_uri in their SmartThings OAuth app

Authorization (once):
  1. User clicks "Connecter avec Samsung"
     → Browser opens:
       https://api.smartthings.com/oauth/authorize
         ?client_id=<client_id>
         &redirect_uri=<redirect_uri>
         &response_type=code
         &scope=r:devices:* x:devices:*

  2. User logs in to Samsung, grants access

  3. Samsung redirects to:
     <redirect_uri>?code=XXXX

  4. Sowel backend receives code, calls plugin.handleOAuthCallback(code)

  5. Plugin POSTs to https://api.smartthings.com/oauth/token:
     grant_type=authorization_code & code=XXXX
     & client_id & client_secret & redirect_uri
     → { access_token, refresh_token, expires_in }

  6. Tokens stored in settingsManager, status → "connected"

Auto-renewal (every 20h):
  Plugin POSTs grant_type=refresh_token to get new access_token
  Stores updated access_token + token_expires_at
```

## Token Storage (settingsManager keys)

| Key                                        | Description                                  |
| ------------------------------------------ | -------------------------------------------- |
| `integration.smartthings.access_token`     | Current access token                         |
| `integration.smartthings.refresh_token`    | Long-lived refresh token (29 days if unused) |
| `integration.smartthings.token_expires_at` | Expiry timestamp (epoch ms)                  |
| `integration.smartthings.client_id`        | OAuth app client ID                          |
| `integration.smartthings.client_secret`    | OAuth app client secret                      |
| `integration.smartthings.redirect_uri`     | Callback URL                                 |
| `integration.smartthings.polling_interval` | Poll interval in seconds                     |

## Sowel Core Changes

### IntegrationPlugin interface (src/integrations/integration-registry.ts)

```typescript
interface IntegrationPlugin {
  // ... existing methods ...
  getOAuthUrl?(): string | null;
  handleOAuthCallback?(code: string): Promise<void>;
}
```

### New routes (src/api/routes/plugins.ts)

```
GET /api/v1/plugins/:pluginId/oauth/url
  → calls plugin.getOAuthUrl()
  → returns { url: string }

GET /api/v1/plugins/:pluginId/oauth/callback?code=...
  → calls plugin.handleOAuthCallback(code)
  → redirects browser to /settings/integrations
```

Both routes require admin auth (except the callback which is called by Samsung's servers — no auth needed, but validated by code exchange).

## UI Changes (integration settings panel)

When plugin exposes `getOAuthUrl()`:

- Show OAuth section below settings fields
- If not connected: blue button "Connecter avec Samsung"
- If connected: green "Connecté ✓" + grey "Reconnecter" button
- On click: `GET /api/v1/plugins/smartthings/oauth/url` → redirect browser to returned URL

## Edge Cases

- **refresh_token expired** (29 days unused): status → "error", UI shows "Reconnecter"
- **Samsung API down**: keep retrying with existing access_token until expiry, then error
- **redirect_uri unreachable** (tunnel down): auth fails gracefully, user retries when tunnel is up
- **Plugin reinstalled**: tokens persist in SQLite, no re-auth needed if refresh_token still valid
- **client_id/secret wrong**: OAuth exchange fails → clear error message in settings

## Plugin Release

- Version: `0.5.0`
- Breaking: removes `token` PAT field — migration note: user must re-authenticate via OAuth

## User Setup Guide (for docs)

1. Go to [developer.smartthings.com](https://developer.smartthings.com) and sign in
2. Create an OAuth app via SmartThings CLI:
   ```bash
   npm install -g @smartthings/cli
   smartthings apps:create -t <your-pat> -i app.json
   ```
   With `app.json`:
   ```json
   {
     "appName": "my-sowel",
     "displayName": "Sowel",
     "description": "Sowel home automation",
     "appType": "API_ONLY",
     "classifications": ["CONNECTED_SERVICE"],
     "oauth": {
       "clientName": "Sowel",
       "scope": ["r:devices:*", "x:devices:*"],
       "redirectUris": ["https://your-sowel-url/api/v1/plugins/smartthings/oauth/callback"]
     }
   }
   ```
3. Copy `oauthClientId` and `oauthClientSecret` from the response
4. In Sowel: Administration > Intégrations > SmartThings > enter credentials + redirect URI
5. Click "Connecter avec Samsung"
