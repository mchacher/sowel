# Shadow instance — quick reference

A **shadow** is a second Sowel server, started with `SOWEL_SHADOW_MODE=1`, that you seed from a production backup so you can test a candidate build against real data without dialing out to anything (no MQTT connect, no cloud poll, no OAuth refresh, no notification fire, no GitHub poll, no recipe order).

Spec 124 makes the inert state a runtime invariant, so you cannot break it by clicking around in the shadow UI: an admin enabling a plugin or recipe persists the SQLite row but the runtime stays inert.

## TL;DR — three commands

```bash
# 1. Deploy the candidate image (build current branch, start containers on http://localhost:3001)
./scripts/shadow-deploy.sh up

# 2. Seed from prod (login, download backup, restore, restart). Reads SOWEL_PROD_PASSWORD.
SOWEL_PROD_PASSWORD='…' ./scripts/shadow-deploy.sh seed

# 3. Open the UI. Login with the same admin / password as prod (the seed reused prod creds).
open http://localhost:3001
```

When done:

```bash
./scripts/shadow-deploy.sh destroy   # remove containers + data dir
```

## What lives where

| Concern        | Local target (default)        | Sowelox target              |
| -------------- | ----------------------------- | --------------------------- |
| URL            | `http://localhost:3001`       | `http://192.168.0.230:3001` |
| Data dir       | `$HOME/sowel-shadow/`         | `/opt/sowel-shadow/`        |
| InfluxDB       | dedicated `shadow-influx`     | dedicated `shadow-influx`   |
| Docker network | `sowel-shadow-net`            | `sowel-shadow-net`          |
| Image tag      | `sowel:shadow-<branch>-<sha>` | same (transferred via ssh)  |
| State pointer  | `data/.shadow-target`         | `data/.shadow-target`       |

Local is the default and recommended path — no SSH transfer, faster iteration, isolated from prod.

## Scripts

### `scripts/shadow-deploy.sh` — lifecycle

```
up [--target=local|sowelox]   Build current branch, create containers, start. Default local.
update                         Alias for `up` (rebuild + recreate sowel-shadow with the new image).
seed                           Login on prod, download backup, restore on shadow, restart container.
                               Env: SOWEL_PROD_HOST (default 192.168.0.230:3000),
                                    SOWEL_PROD_USER (default admin),
                                    SOWEL_PROD_PASSWORD (prompted if unset).
down                           Stop and remove containers + network. Keep data dir.
destroy                        down + delete the data dir. IRREVERSIBLE (prompts).
status                         Containers + network + data dir state on the chosen target.
```

Guards on `up`:

- Refuses with `--target=sowelox` if prod is not running on sowelox (fix prod first).
- Warns + prompts if the working tree is dirty (the image tag carries the SHA but not your uncommitted diff).
- Refuses to switch target while a shadow exists on the other target — run `down` first.

### `scripts/run-swap.sh` — daily on/off

```
shadow [start]   Start the deployed shadow container.
shadow stop      Stop the shadow container. Containers preserved.
shadow status    Running / stopped / safety banner observed.
stop             Global stop (local dev + remote prod + shadow).
status           Global state (local dev + remote prod + shadow).
```

The shadow target is auto-detected from `data/.shadow-target` written by `shadow-deploy.sh`. Local vs sowelox is transparent to `run-swap.sh`.

## Verifying inert state

The deploy and seed steps both wait for the safety banner before they return success. To check at any time:

```bash
# In logs
docker logs sowel-shadow 2>&1 | grep "SHADOW MODE"

# Via API (any authenticated user)
curl -H "Authorization: Bearer <jwt>" http://localhost:3001/api/v1/system/mode
# → {"shadowMode": true}
```

In the UI: a non-dismissable amber **MODE SHADOW** stripe at the top of every page when the flag is on.

After a `seed` followed by `docker restart`, every prod plugin has `enabled=1` in the restored SQLite but every one is `disconnected` in `/api/v1/plugins`. That is the proof that the runtime gates work.

## What shadow mode does NOT prevent

The runtime gates close outbound paths inside Sowel. They do not guard against host-level misconfiguration:

- **`INFLUX_URL` pointed at prod.** Would write into prod's bucket via the history writer. The deploy script always provisions a dedicated `shadow-influx` container; do not override `INFLUX_URL`.
- **MQTT broker URLs inside backed-up settings.** Plugins do not connect because they are gated, but if you toggle the env var off while still on the shadow data dir, they will. Treat the shadow data dir as toxic and `destroy` it after the test.
- **OAuth credentials inside backed-up settings.** Same logic — gated as long as plugins do not boot. Manual SQL pokes that fire a plugin's runtime path defeat the gate.
- **Self-update / backup-helper containers.** Independent of shadow mode. Don't trigger them on a shadow.

## Recovery if the shadow connected out

You realised the shadow boot lacked `SOWEL_SHADOW_MODE=1` — typically because the env var fell off a `docker run` line.

```bash
# 1. Stop the shadow now
./scripts/run-swap.sh shadow stop
```

2. Force OAuth re-auth on prod for every cloud integration whose refresh token may have rotated on the shadow: open prod UI → **Integrations** → Reconnect (Legrand Control / Legrand Energy / Panasonic Comfort Cloud / Netatmo Weather / Netatmo Security / SmartThings).

3. Check prod logs for stray orders or notifications fired by the shadow:

   ```bash
   ssh mchacher@192.168.0.230 'docker exec sowel grep -E "order|notif" /app/data/logs/sowel.0.log | tail -50'
   ```

4. Record the incident below so the procedure can be tightened.

## Why a shared production DB cannot be the shadow

Two writers on the same SQLite file with WAL is not safe — it will eventually corrupt the journal. The backup-restore-shadow-mode path is the only safe pattern.

## Lessons learned

> Append a dated entry every time the procedure is exercised, especially when something surprised you.

- (No entries yet — be the first.)
