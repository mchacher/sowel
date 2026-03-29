# Debug Bug Reference

## Log Modules

| Module                         | Domain                       |
| ------------------------------ | ---------------------------- |
| `device-manager`               | Device CRUD, data updates    |
| `equipment-manager`            | Equipment CRUD, bindings     |
| `zone-aggregator`              | Zone aggregation             |
| `recipe-manager`               | Recipe instantiation         |
| `mode-manager`                 | Mode activation/deactivation |
| `integration-registry`         | Integration lifecycle        |
| `integration-zigbee2mqtt`      | Z2M MQTT integration         |
| `legrand-hc`                   | Netatmo/Legrand Home+Control |
| `legrand-hc-poller`            | Netatmo polling              |
| `integration-panasonic-cc`     | Panasonic Comfort Cloud      |
| `integration-mcz-maestro`      | MCZ Maestro stove            |
| `plugin-manager`               | Plugin lifecycle             |
| `plugin:smartthings`           | SmartThings plugin           |
| `weather-forecast`             | Weather forecast plugin      |
| `history-writer`               | InfluxDB writes              |
| `energy-aggregator`            | Energy HP/HC classification  |
| `websocket`                    | WebSocket connections        |
| `auth-service`                 | Authentication, tokens       |
| `mqtt`                         | MQTT broker connections      |
| `mqtt-publish-service`         | MQTT publishers              |
| `notification-publish-service` | Notifications                |
| `database`                     | SQLite operations            |
| `migrations`                   | Schema migrations            |

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
