# Plugin: Samsung SmartThings

## Summary

A Sowel plugin that integrates Samsung SmartThings devices via the SmartThings REST API. Uses a Personal Access Token (PAT) for authentication and polling for data updates. V1 targets two device categories: TV (media_player) and washing machine (appliance).

## Acceptance Criteria

- [ ] Plugin discovers all SmartThings devices on the account
- [ ] Washer device exposes: power, operating state, job phase, progress, remaining time, energy consumption
- [ ] TV device exposes: power, volume, mute, input source, picture mode
- [ ] TV orders: power on/off, volume set, mute toggle, change input source
- [ ] Polling interval configurable (default 300s)
- [ ] PAT configured via integration settings in the UI
- [ ] Plugin installable from the Sowel plugin store
- [ ] Two new equipment types: `media_player` and `appliance`

## Scope

### In Scope

- SmartThings REST API integration via PAT
- Device discovery (all devices on account)
- Data polling for washer and TV capabilities
- Orders for TV (power, volume, mute, input source)
- New equipment types: `media_player`, `appliance`
- Plugin packaged as external GitHub repo (`sowel-plugin-smartthings`)

### Out of Scope

- OAuth2 flow (PAT only for V1)
- Webhooks / real-time events (polling only)
- Washer commands (start/stop cycle) — read-only for V1
- Other SmartThings device types (fridge, vacuum, AC) — discovered but limited to generic data
- Custom UI cards for media_player / appliance (standard sensor display for V1)

## Edge Cases

- TV is off → SmartThings may return stale data or `null` values. Plugin should mark device as offline if switch=off.
- PAT expired or revoked → poll returns 401. Plugin should set status to `error` and log a warning.
- SmartThings API rate limit → 429 response. Plugin should back off and retry on next poll cycle.
- Device removed from SmartThings → disappears from discovery. Existing Sowel device stays but goes offline.
