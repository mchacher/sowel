# Shadow instance — testing a candidate build against production data

A **shadow instance** is a second Sowel server, run on a separate machine, restored from a production backup, and started with `SOWEL_SHADOW_MODE=1`. With that env var set, every outbound subsystem — plugin lifecycle, recipes, MQTT publishers, notification publishers, GitHub version polling — is gated off both at boot and at runtime. The shadow can serve the UI against real data and can be poked at, but it cannot dial out and therefore cannot touch production.

> The env var is the safety: as long as it is set on the shadow process, the inert invariant holds. If you forget to set it, the shadow boots like a normal Sowel — see [Recovery](#recovery-if-the-shadow-connected-out).

## When to use a shadow

- Validating a read-time feature against real energy / history data before a release (e.g. spec 123 cost valuation).
- Reproducing a UI bug that needs real data.
- Trying a migration on a copy of production data before publishing the version.
- Practising a restore flow.

Do **not** use a shadow when a one-line dev environment would suffice. The shadow is heavyweight and the cleanup steps matter.

## Hard rules

1. **The shadow runs on a machine that is NOT sowelox.** A laptop is fine. A container on sowelox itself is not — too easy to bind-mount the wrong path.
2. **The shadow has its own InfluxDB.** Never point `INFLUX_URL` at production's Influx — `SOWEL_SHADOW_MODE` gates outbound integrations but does not protect a misconfigured Influx URL.
3. **The shadow has its own Docker network.** No shared `host.docker.internal` to sowelox.
4. **`SOWEL_SHADOW_MODE=1` must be set on every `docker run` of the shadow container.** Without it, the inert invariant is gone.
5. **Never push the shadow image to ghcr.io with a tag production might pull.** Build it locally and keep it local. If you must publish, use `:shadow-YYYYMMDD` and never `:latest`.

## The procedure

### Step 0 — Pre-flight checklist

- [ ] You are on a workstation that has the `sowel` repo checked out on the branch you want to test.
- [ ] You have SSH access to `mchacher@192.168.0.230` (sowelox).
- [ ] The candidate branch has been pushed and CI is green (or you accept building locally).

### Step 1 — Create the backup on production

On the production UI (`http://192.168.0.230:3000`):

1. **Admin > Backup > Create backup**
2. Wait for the spinner to finish, then **Download** the resulting ZIP. The file looks like `sowel-backup-YYYY-MM-DD-HHMMSS.zip`.

Backup creation is read-only on SQLite (transaction) and read-only on InfluxDB (query). Safe to run while production is in use.

Verify the archive before going further:

```bash
unzip -l ~/Downloads/sowel-backup-*.zip | head -30
# Expect: sowel-backup.json, influx-raw.lp, influx-hourly.lp, influx-daily.lp,
#         influx-energy-hourly.lp, influx-energy-daily.lp, data/...
```

If `sowel-backup.json` is missing, the backup is invalid — stop and re-create.

### Step 2 — Launch the shadow with the candidate image and `SOWEL_SHADOW_MODE=1`

```bash
# On the dev workstation, at the repo root, on the feature branch
git status                       # confirm you are on the right branch
docker build -t sowel:candidate .

export SHADOW_DIR="$HOME/sowel-shadow"
mkdir -p "$SHADOW_DIR/data" "$SHADOW_DIR/influx"

# Dedicated Docker network — no shared host bridge.
docker network create sowel-shadow-net

docker run -d --name shadow-influx \
  --network sowel-shadow-net \
  -v "$SHADOW_DIR/influx:/var/lib/influxdb2" \
  -e DOCKER_INFLUXDB_INIT_MODE=setup \
  -e DOCKER_INFLUXDB_INIT_USERNAME=shadow \
  -e DOCKER_INFLUXDB_INIT_PASSWORD=shadowpass \
  -e DOCKER_INFLUXDB_INIT_ORG=sowel \
  -e DOCKER_INFLUXDB_INIT_BUCKET=sowel \
  -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=shadow-influx-token \
  influxdb:2.7

docker run -d --name sowel-shadow \
  --network sowel-shadow-net \
  -p 3001:3000 \
  -v "$SHADOW_DIR/data:/app/data" \
  -e TZ=Europe/Paris \
  -e INFLUX_URL=http://shadow-influx:8086 \
  -e INFLUX_TOKEN=shadow-influx-token \
  -e INFLUX_ORG=sowel \
  -e INFLUX_BUCKET=sowel \
  -e SOWEL_SHADOW_MODE=1 \
  sowel:candidate
```

Wait ~10 s, open `http://localhost:3001`. You should see:

- An amber **SHADOW MODE** banner stripe at the very top of every page.
- The Sowel **first-run setup** screen below the banner.

Verify the boot log emitted the safety banner:

```bash
docker logs sowel-shadow 2>&1 | grep "SHADOW MODE"
# SHADOW MODE ACTIVE — outbound integrations, recipes, publishers, and version checks are disabled. ...
```

Create a temporary admin (`shadow` / `shadow`); it will be overwritten by the restore.

### Step 3 — Restore the production backup

In the shadow UI:

1. **Admin > Backup > Restore**
2. Upload the ZIP from Step 1.
3. Confirm. The restore finishes with a banner saying _Restart required to reload_.

Restart the shadow container so the restored state is picked up:

```bash
docker restart sowel-shadow
# Verify the safety banner still shows in the boot log after restart.
docker logs sowel-shadow 2>&1 | tail -50 | grep "SHADOW MODE"
```

`SOWEL_SHADOW_MODE=1` is still set, so even though the restored SQLite has every plugin / recipe / publisher row at `enabled = 1`, nothing connects out. The amber banner stays. The integrations page lists every plugin as disconnected.

### Step 4 — Test

Browse `http://localhost:3001`, exercise the change you are validating. Any action that would normally fire an outbound effect (enable a plugin, save a recipe instance, configure an MQTT publisher) is silently neutered at runtime — the SQLite row is written, but the plugin / recipe / publisher never boots. Check the shadow logs to see the `shadow-mode` warn lines whenever this happens.

### Step 5 — Cleanup

```bash
docker stop sowel-shadow shadow-influx
docker rm sowel-shadow shadow-influx
docker network rm sowel-shadow-net
rm -rf "$SHADOW_DIR"
docker image rm sowel:candidate    # optional
```

The production backup ZIP can be kept in cold storage or deleted — it contains the same data the next backup will contain.

## What shadow mode does NOT prevent

Spec 124's gates close the outbound paths inside Sowel itself. They do not protect against misconfiguration of the surrounding environment:

- **InfluxDB URL pointed at production.** If `INFLUX_URL` aims at the production Influx, the history writer (which is gated off neither by shadow mode nor by anything else — it serves the UI's energy / Analyse charts) would write into prod's bucket. The playbook above creates a dedicated `shadow-influx` container; do not skip it.
- **MQTT broker URL inside backed-up settings.** The shadow's SQLite carries the production MQTT broker URL. Plugins do not connect because shadow mode gates them off, but if you ever toggle the env var off while still on the shadow data dir, they will. Treat `data-shadow/` as toxic and discard it after the test.
- **OAuth credentials inside backed-up settings.** Same logic. Shadow mode never lets the plugins boot, so the refresh tokens are never touched. Manual SQL that pokes a plugin's runtime state would defeat this — don't.
- **Filesystem / docker socket access.** Self-update and backup-helper containers are independent of shadow mode. Don't trigger them on the shadow.

## Recovery if the shadow connected out

If you realise too late that you started the shadow without `SOWEL_SHADOW_MODE=1` — typically because the env var fell off a `docker run` line — act immediately:

1. **Stop the shadow** to cap further damage:

   ```bash
   docker stop sowel-shadow
   ```

2. **Force OAuth re-auth on production** for every cloud integration whose refresh token may have rotated on the shadow:
   - Open production UI > **Integrations** > for each of Legrand Control / Legrand Energy / Panasonic Comfort Cloud / Netatmo Weather / Netatmo Security / SmartThings: **Reconnect**.
   - If reconnect fails (refresh token already burned), the plugin needs the OAuth flow restarted from scratch.

3. **Check production logs** for any order or notification that the shadow may have fired in the meantime:

   ```bash
   ssh mchacher@192.168.0.230 'docker exec sowel grep -E "order|notif" /app/data/logs/sowel.0.log | tail -50'
   ```

4. If a physical device acted (light turned on, valve opened), restore its state manually from the UI.

5. **Record what happened** in this page's lessons-learned section so the procedure can be hardened.

## Why a shared production DB cannot be the shadow

A common temptation is to bind-mount production's `/opt/sowel/data` into a second container. **Do not do this.** Sowel uses SQLite in WAL mode and writes on every boot (settings, plugin states, audit log, last-events table). Two writers on the same SQLite file with WAL is not safe and will eventually corrupt the journal — silently first, then catastrophically. The backup > restore > shadow-mode-env path is the only safe pattern.

## Verifying shadow mode is actually on

If you ever want to confirm a running container is inert without reading logs:

```bash
curl -s -b auth-cookie http://localhost:3001/api/v1/system/mode
# {"shadowMode":true}
```

(`/api/v1/system/mode` requires authentication, like the rest of `/system/*`.)

## Lessons learned

> Append a dated entry every time the procedure is exercised, especially when something surprised you. The goal is to make the next person's run faster and safer.

- (No entries yet — be the first.)
