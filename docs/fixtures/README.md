# Documentation fixtures

This folder holds reusable Sowel backup archives used to drive **documentation screenshots**. The goal is to make screenshot regeneration repeatable: any contributor can restore a fixture onto a clean Sowel instance (for example a Raspberry Pi on your LAN) and capture the same UI states as the ones embedded in `docs/`.

## Files

| File              | Purpose                                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `showroom-fr.zip` | Anonymized FR snapshot derived from the maintainer's production. Restorable via `POST /api/v1/backup`. Drives the FR user guide screenshots. |
| `showroom-en.zip` | Same content as `showroom-fr.zip` with zone and equipment names translated to English. Drives the EN user guide screenshots.                 |

Both archives contain a single `sowel-backup.json` (the engine state) and no InfluxDB history, no integration credentials, and no user accounts. After restore, the engine is in a fully populated state but with all integrations disabled and a fresh admin to create via the setup wizard.

## Regenerating the fixtures

Both fixtures are built from a fresh production backup with `scripts/doc/build-fixtures.py`:

```bash
# 1. Export a backup from the prod Sowel instance
curl -s -H "Authorization: Bearer $TOKEN" http://<prod>:3000/api/v1/backup -o prod-backup.zip

# 2. Run the build script
python3 scripts/doc/build-fixtures.py prod-backup.zip

# Output: showroom-fr.zip and showroom-en.zip in the same folder as the input
```

The script:

- removes integration credentials (`settings.integration.*`, `mqtt.*`, `z2m.*`)
- strips API tokens, user accounts, MQTT broker config, notification publishers
- empties `device_data` and `device_orders` (live cache)
- marks all devices as `offline` and clears their `raw_expose`
- renames personal data (children's bedroom names, named motion sensors)
- removes the washing machine equipment
- replaces `home.name` with a neutral value and the coordinates with Paris (48.85, 2.35)
- applies a FR to EN mapping to produce the second variant

Edit `scripts/doc/build-fixtures.py` to tweak the anonymization or translation maps.

## Restoring a fixture on a demo instance

```bash
# Reset the demo instance to zero
ssh <demo-host> 'cd <demo-compose-dir> && docker compose down -v && docker compose up -d'

# Wait for the wizard to come up, create an admin via the UI, then:
TOKEN=$(curl -s -X POST http://<demo-host>:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  --data-raw '{"username":"admin","password":"<your-admin-pw>"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

curl -X POST http://<demo-host>:3001/api/v1/backup \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@docs/fixtures/showroom-fr.zip"
```

The instance restarts with the fixture state; integrations stay disabled, so no MQTT or cloud poll runs.

## When to regenerate

Regenerate fixtures (and replay the screenshot workflow) whenever:

- the prod data model changes in a way that breaks the snapshot
- the UI changes enough that the existing screenshots are misleading
- the registry or feature catalogue grows enough that the integrations or plugins page looks dated
