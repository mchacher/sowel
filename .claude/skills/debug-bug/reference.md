# Debug Bug Reference

## Log Modules (current, spec 053+)

| Module                             | Domain                                        |
| ---------------------------------- | --------------------------------------------- |
| `device-manager`                   | Device CRUD, data updates                     |
| `equipment-manager`                | Equipment CRUD, bindings, order dispatch      |
| `zone-manager` / `zone-aggregator` | Zones, aggregation                            |
| `sunlight-manager`                 | Sunrise/sunset, isDaylight transitions        |
| `recipe-manager`                   | Recipe engine (instances, triggers, actions)  |
| `mode-manager`                     | Mode activation/deactivation                  |
| `calendar-manager`                 | Croner calendar slots                         |
| `button-action-manager`            | Physical button actions                       |
| `integration-registry`             | Integration lifecycle (plugins register here) |
| `plugin-loader`                    | Plugin loader (integrations)                  |
| `recipe-loader`                    | Recipe loader (recipe packages)               |
| `package-manager`                  | Package download, install, update, remove     |
| `plugin:zigbee2mqtt`               | Zigbee2MQTT plugin                            |
| `plugin:lora2mqtt`                 | LoRa2MQTT plugin                              |
| `plugin:panasonic_cc`              | Panasonic Comfort Cloud plugin                |
| `plugin:mcz_maestro`               | MCZ Maestro plugin                            |
| `plugin:legrand_control`           | Legrand Home+Control plugin                   |
| `plugin:legrand_energy`            | Legrand energy monitoring plugin              |
| `plugin:netatmo_weather`           | Netatmo Weather Station plugin                |
| `plugin:smartthings`               | Samsung SmartThings plugin                    |
| `plugin:weather-forecast`          | Open-Meteo weather forecast plugin            |
| `backup-manager`                   | Backup export/restore                         |
| `update-manager`                   | Self-update (helper container)                |
| `version-checker`                  | GitHub releases poll                          |
| `history-writer`                   | InfluxDB history writes                       |
| `energy-aggregator`                | Energy HP/HC classification, aggregation      |
| `websocket`                        | WebSocket connections                         |
| `auth-service`                     | Authentication, tokens                        |
| `mqtt-broker-manager`              | Outbound MQTT brokers                         |
| `mqtt-publish-service`             | MQTT publishers                               |
| `notification-publish-service`     | Notifications (telegram, ntfy, webhook, FCM)  |
| `influx-client`                    | InfluxDB connection / queries                 |
| `database`                         | SQLite operations                             |
| `migrations`                       | Schema migrations                             |

The plugin modules are always prefixed `plugin:<id>` — the `<id>` matches the `manifest.json` id. Some plugins add a second-level module (e.g. `plugin:zigbee2mqtt > z2m-parser`).

## Log Retrieval Commands

### fetch-logs.py (preferred)

```bash
# Syntax: python3 scripts/logs/fetch-logs.py <module> <level> <limit>
# Environment: SOWEL_URL (default http://localhost:3000), SOWEL_PASSWORD (prompts if unset)

python3 scripts/logs/fetch-logs.py "" error 50          # All errors
python3 scripts/logs/fetch-logs.py "" warn 100           # All warnings
python3 scripts/logs/fetch-logs.py device-manager debug 100
python3 scripts/logs/fetch-logs.py equipment-manager debug 100
python3 scripts/logs/fetch-logs.py zone-aggregator debug 100
python3 scripts/logs/fetch-logs.py recipe-manager debug 100
python3 scripts/logs/fetch-logs.py history-writer debug 50
python3 scripts/logs/fetch-logs.py websocket debug 50
```

### Direct API

```bash
TOKEN=$(curl -s http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  --data-raw '{"username":"admin","password":"<pwd>"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

# Query logs
curl -s "http://localhost:3000/api/v1/logs?module=<module>&level=<level>&limit=100" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Search by text
curl -s "http://localhost:3000/api/v1/logs?search=<keyword>&limit=100" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# List available modules
curl -s "http://localhost:3000/api/v1/logs" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print('\n'.join(json.load(sys.stdin)['modules']))"
```

## Diagnostic Commands

```bash
# Health check
curl -s http://localhost:3000/api/v1/health | python3 -m json.tool

# Integration status
curl -s http://localhost:3000/api/v1/integrations \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# List devices
curl -s http://localhost:3000/api/v1/devices \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Check equipment bindings
curl -s http://localhost:3000/api/v1/equipments/<id> \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Zone aggregation
curl -s http://localhost:3000/api/v1/zones/<id> \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# SQLite quick query
sqlite3 data/sowel.db "SELECT key, substr(value, 1, 80) FROM settings;"
```

## Production log file access (spec 015, updated spec 060)

The ring buffer is in-memory only and lost on restart. **For post-incident investigation after a container recreation (e.g. after self-update)**, use the persistent log files on the `sowel-data` volume:

```bash
# SSH to sowelox
ssh mchacher@192.168.0.230

# List log files (14 days daily rotation)
docker exec sowel ls -la /app/data/logs/

# View today's log (sowel.6.log is usually the newest — file numbers rotate)
docker exec sowel cat /app/data/logs/sowel.6.log | tail -100

# Grep a time window (UTC in logs) for error/warn
docker exec sowel sh -c 'cat /app/data/logs/sowel.6.log | grep -E "2026-04-11T07:" | grep -E "\"level\":\"(error|warn)\""'
```

⚠️ **Logs are in UTC** (`time` field). To correlate with user timestamps (typically local CEST = UTC+2), convert before filtering.

## InfluxDB Diagnostics (energy/history bugs)

```bash
npx tsx scripts/energy/raw-inspect.ts      # Inspect raw data points
npx tsx scripts/energy/scan-gaps.ts        # Scan for missing days
npx tsx scripts/energy/compare.ts          # Compare raw vs hourly
```

## Common Bug Patterns

| Pattern                         | Likely cause                                                    |
| ------------------------------- | --------------------------------------------------------------- |
| Device data not updating        | Integration disconnected, parser error, wrong MQTT topic        |
| Equipment data stale            | Binding expression error, event handler not registered          |
| Zone aggregation wrong          | Aggregation formula bug, equipment not in zone, event missed    |
| Scenario not firing             | Trigger condition wrong, mode filter active, error in action    |
| UI not reflecting changes       | WebSocket disconnected, store not subscribed, wrong event type  |
| API returns 500                 | Unhandled error in route handler, DB schema mismatch            |
| API returns 401/403             | Token expired, wrong role, middleware misconfiguration          |
| Energy data missing             | InfluxDB connection issue, poller stopped, bucket misconfigured |
| Order not reaching device       | Integration not connected, wrong topic, order format mismatch   |
| Computed data not recalculating | Expression parser error, circular dependency, missing binding   |
