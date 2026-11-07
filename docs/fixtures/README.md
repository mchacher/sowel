# Documentation fixtures

This folder holds reusable Sowel backup archives used to drive **documentation screenshots**. The goal is to make screenshot regeneration repeatable: any contributor can restore a fixture onto a clean Sowel instance (for example a Raspberry Pi on your LAN) and capture the same UI states as the ones embedded in `docs/`.

## Files

| File              | Purpose                                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `showroom-fr.zip` | Anonymized FR snapshot derived from the maintainer's production. Restorable via `POST /api/v1/backup`. Drives the FR user guide screenshots. |
| `showroom-en.zip` | Same content as `showroom-fr.zip` with zone, equipment, mode and saved-chart names translated to English. Drives the EN user guide screenshots.                 |

Both archives contain a single `sowel-backup.json` (the engine state) and no InfluxDB history, no integration credentials and no InfluxDB connection settings. Their only user is a baked-in admin (`admin` / `sowel-demo-2026`), so the restore lands in a usable state. A blank instance still needs a first admin through the setup wizard, only to obtain the token the restore call requires; the restore then replaces it with the fixture admin. Every device is restored offline.

The English fixture translates zone, equipment and mode names and saved charts (Analyse). Device names are kept: they are what the integration published, as on a real network. So are the Calendar week profiles `Travail` and `Vacances`: they are built-in, seeded in French by the first migration, and every install shows them under those names.

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

- removes integration credentials and the old InfluxDB connection settings (`settings.integration.*`, `mqtt.*`, `z2m.*`, `history.influx.*`)
- strips API tokens, MQTT broker config, notification publishers, and replaces the user accounts with the baked-in admin
- keeps `device_data` and `device_orders` (the bindings reference them; the values are cached readings, not personal)
- marks all devices as `offline` and clears their `raw_expose`
- renames personal data (children's bedroom names, named motion sensors, devices named after people)
- removes the washing machine equipment
- replaces `home.name` with a neutral value and the coordinates with Paris (48.85, 2.35)
- applies a FR to EN mapping to produce the second variant
- refuses to write a fixture in which a household name survives, or an English one that still carries French names

Edit `scripts/doc/build-fixtures.py` to tweak the anonymization or translation maps.

The maps only need the French names, so a map change can be applied without a new production backup: run the script on the committed `showroom-fr.zip` (copied elsewhere first, since the script writes next to its input). That is how the November 2026 rebuild dropped the device names `remote_marc` and `remote_elodie`, which the committed archives still carried after the script had learnt to rename them, and the `history.influx.*` settings, a production InfluxDB URL and access token included.

## Restoring a fixture on a local instance

`docker-compose.docs.yml` at the repository root starts a throwaway Sowel on
port 3001, with its own volumes and no Docker socket. Nothing else is needed:
there is no demo host to keep alive.

```bash
# Reset to zero — `down -v` wipes only this instance's volumes
docker compose -f docker-compose.docs.yml down -v
docker compose -f docker-compose.docs.yml up -d

# Wait for the API, then create the first admin through the setup wizard
until curl -sf http://localhost:3001/api/v1/auth/status >/dev/null; do sleep 2; done

TOKEN=$(curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  --data-raw '{"username":"admin","password":"<your-admin-pw>"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

curl -X POST http://localhost:3001/api/v1/backup \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@docs/fixtures/showroom-fr.zip"
```

The instance restarts with the fixture state; integrations stay disabled, so no
MQTT or cloud poll runs. Tear it down with `down -v` when you are done.

## When to regenerate

Regenerate fixtures (and replay the screenshot workflow) whenever:

- the prod data model changes in a way that breaks the snapshot
- the UI changes enough that the existing screenshots are misleading
- the registry or feature catalogue grows enough that the integrations or plugins page looks dated
