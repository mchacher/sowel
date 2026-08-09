# Guide de déploiement

Ce guide couvre le déploiement, la mise à jour, la sauvegarde et le dépannage de Sowel en production.

---

## Déploiement initial

Sowel est livré sous forme d'image Docker à `ghcr.io/mchacher/sowel:latest`. Un déploiement de production se compose de deux conteneurs (`sowel` + `sowel-influxdb`) orchestrés par `docker compose`.

### Prérequis

- Hôte Linux ou macOS avec Docker Engine 20.10+ et `docker compose` v2 (images multi-arch : `linux/amd64` et `linux/arm64` — Raspberry Pi 4/5 supportés en natif)
- Au moins 2 Go de RAM, 10 Go de disque (les données InfluxDB grossissent avec le temps)
- Accès réseau à `ghcr.io` pour les pulls d'image et `api.github.com` pour les vérifications de version

### Option A — Installation en une commande (recommandée)

```bash
curl -fsSL https://raw.githubusercontent.com/mchacher/sowel/main/scripts/install.sh | sh
```

Ce que ça fait :

- Vérifie que Docker et Docker Compose v2 sont installés et joignables
- Crée `~/sowel/` (override avec `SOWEL_DIR=/opt/sowel`)
- Télécharge le `docker-compose.yml` de référence
- Détecte automatiquement le fuseau horaire de l'hôte et patche le compose (plus de logs en UTC)
- Tire les images, démarre la stack, attend que `/api/v1/health` réponde
- Affiche l'URL et les commandes utiles (logs / update / stop)

Override du port d'hôte : `SOWEL_PORT=8080 curl -fsSL ... | sh`.

Si une installation existe déjà à `$SOWEL_DIR`, le script refuse d'écraser — choisissez un autre dossier ou supprimez l'existant d'abord.

### Option B — Déploiement manuel

Pour un contrôle complet sur chaque étape :

```bash
# 1. Pick a deployment directory (convention: /opt/sowel)
sudo mkdir -p /opt/sowel
sudo chown $USER:$USER /opt/sowel
cd /opt/sowel

# 2. Download the reference docker-compose.yml
curl -O https://raw.githubusercontent.com/mchacher/sowel/main/docker-compose.yml

# 3. Optional: set your timezone (recommended — fixes calendar scheduling,
#    HP/HC tariff classification, sunrise/sunset display)
#    Edit docker-compose.yml and uncomment / add:
#      - TZ=Europe/Paris

# 4. Launch
docker compose up -d

# 5. Check containers are up
docker compose ps

# 6. Open the UI and create the first admin
open http://<host>:3000
```

Au premier boot, Sowel :

- Crée sa base SQLite à `/app/data/sowel.db` (sur le volume `sowel-data`)
- Génère un secret JWT persistant (`data/.jwt-secret`) et un token admin InfluxDB
- Attend que vous créiez le premier admin via l'écran de setup de l'UI

### Volumes

| Volume          | Mount                | Contenu                                                        |
| --------------- | -------------------- | -------------------------------------------------------------- |
| `sowel-data`    | `/app/data`          | Base SQLite, logs, secrets, backups, fichiers de données       |
| `sowel-plugins` | `/app/plugins`       | Fichiers de plugins installés (`dist/`, `manifest.json`, etc.) |
| `influxdb-data` | `/var/lib/influxdb2` | Stockage de séries temporelles                                 |

Ce sont des **volumes Docker nommés**, persistants à travers les recréations de conteneurs. Ce sont eux qui font fonctionner l'auto-update et le backup/restore : les données stateful survivent.

### Auto-update activé par défaut (depuis v1.15.3)

Le `docker-compose.yml` officiel monte `/var/run/docker.sock` dans le conteneur Sowel afin que le bouton **"Mettre à jour maintenant"** de l'UI Admin fonctionne dès la première installation.

**Compromis sécurité** : monter le socket Docker donne au conteneur le contrôle effectif du démon Docker hôte. Une RCE réussie contre Sowel (par ex. via une dépendance compromise) escalade en root sur l'hôte. Pour une installation domestique mono-utilisateur derrière un réseau de confiance ou un tunnel Cloudflare + auth admin, ce trade-off est généralement acceptable, mais reste un choix conscient.

Pour **désactiver** (déploiement hardening ou multi-tenant), retirer la ligne `/var/run/docker.sock:/var/run/docker.sock` du `docker-compose.yml` et relancer `docker compose up -d`. Le bouton "Mettre à jour" sera désactivé et `POST /api/v1/system/update` renverra 503 ; la mise à jour manuelle reste possible :

```bash
docker compose pull && docker compose up -d sowel
```

Ce défaut a été inversé en v1.15.3 (par rapport à la décision v1.7.0 / spec 105) après retour terrain : la quasi-totalité des installs tombait sur le message "update unavailable" sans deviner qu'il fallait copier un fichier override.

---

## Exploitation

### Vérifier le statut

```bash
docker compose ps
docker logs -f sowel          # live logs from stdout
docker logs --tail 100 sowel  # last 100 lines
```

Ou via l'API :

```bash
curl -s http://localhost:3000/api/v1/health | jq
```

### Redémarrer

```bash
docker compose restart sowel
```

Le ring buffer est en mémoire, le redémarrage le vide. Le log fichier (`data/logs/sowel-N.log`) survit.

### Stop / start

```bash
docker compose stop
docker compose start
```

### Reconstruire le conteneur (sans changement d'image)

```bash
docker compose up -d --force-recreate sowel
```

---

## Mises à jour

Sowel prend en charge **deux chemins** : auto-update depuis l'UI (facile) et mise à jour manuelle via compose (fallback).

### Chemin 1 : auto-update depuis l'UI (préféré)

1. Connectez-vous en admin
2. Ouvrez les réglages / le badge de version. Si une mise à jour est disponible, un badge affiche "vX.Y.Z"
3. Cliquez sur le badge → confirmez dans la modale
4. Sowel crée un backup automatique, puis spawne un container helper qui fait le swap
5. L'UI affiche un overlay "Update in progress"
6. Après environ 30 à 90 secondes, la page se recharge sur la nouvelle version

**Prérequis** :

- Tourner sous `docker compose` (Sowel le détecte via les labels du conteneur)
- `/var/run/docker.sock` monté dans le conteneur sowel
- `docker-compose.yml` dans un répertoire bind-monté ou accessible sur l'hôte

Si un prérequis manque, le bouton Update est désactivé avec un tooltip qui explique quoi faire.

### Chemin 2 : mise à jour manuelle via docker compose (fallback)

```bash
cd /opt/sowel
docker compose pull sowel   # fetch the latest image from ghcr.io
docker compose up -d sowel  # recreate the container
```

Sowel redémarre, les migrations s'exécutent automatiquement, les plugins sont auto-téléchargés s'ils sont manquants (spec 058), et l'UI reprend.

**À utiliser quand** :

- L'UI d'auto-update est désactivée (pas de socket Docker, déploiement non-compose)
- Mise à jour à travers une version qui contient elle-même un bug d'auto-update (par ex. depuis v1.0.6, qui avait la race condition corrigée en v1.0.7)
- Vous voulez épingler une version spécifique. Modifiez `docker-compose.yml` en `ghcr.io/mchacher/sowel:1.0.7` avant le `pull`

---

## Backup et restauration

Les backups capturent SQLite, les données InfluxDB et tous les fichiers `data/*` dynamiques dans un seul ZIP.

### Backup manuel (export)

**Depuis l'UI** : Admin → Backup → "Télécharger un backup". Le navigateur télécharge un fichier `sowel-backup-<date>.zip`.

**Depuis l'API** :

```bash
TOKEN=$(curl -s http://<host>:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  --data-raw '{"username":"admin","password":"<pwd>"}' | jq -r .accessToken)

curl -s http://<host>:3000/api/v1/backup \
  -H "Authorization: Bearer $TOKEN" \
  -o sowel-backup.zip
```

### Backups pré-update automatiques (locaux)

Avant chaque auto-update, Sowel crée un backup dans `data/backups/sowel-backup-pre-v<version>-<timestamp>.zip`. Les trois plus récents sont conservés ; les plus anciens sont rotés.

**Lister les backups locaux** :

- Depuis l'UI : Admin → Backup → section "Backups locaux"
- Via l'API : `GET /api/v1/backup/local`

**Restaurer un backup local** :

- Depuis l'UI : cliquez sur "Restaurer" à côté du backup dans la liste
- Via l'API : `POST /api/v1/backup/restore-local { "filename": "sowel-backup-pre-v1.0.7-2026-04-11T08-28-45.zip" }`

### Restauration manuelle (import)

**Depuis l'UI** : Admin → Backup → "Charger un backup".

**Depuis l'API** :

```bash
curl -s -X POST http://<host>:3000/api/v1/backup \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@sowel-backup.zip"
```

Après restauration, Sowel renvoie `{ restartRequired: true }`. Vous devez redémarrer le conteneur pour que l'état restauré prenne pleinement effet :

```bash
docker compose restart sowel
```

### Contenu de l'archive

Voir la section "Backup et restauration" dans [architecture.md](architecture.md) pour le format complet.

---

## Accès aux logs

### Trois sources

| Source                                              | Rétention                                       | Cas d'usage                                                                               |
| --------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Ring buffer** (mémoire)                           | Perdu au redémarrage                            | Tail live via UI Admin → Logs                                                             |
| **stdout Docker**                                   | Par conteneur (perdu à la recréation)           | `docker logs sowel`                                                                       |
| **Fichiers `pino-roll`** sur le volume `sowel-data` | 14 fichiers journaliers, survit à la recréation | **Investigation post-incident**, la seule source qui survit aux recréations d'auto-update |

### Accéder aux logs fichiers

```bash
# List files
docker exec sowel ls -la /app/data/logs/

# View today's log
docker exec sowel cat /app/data/logs/sowel.6.log

# Grep errors/warns in a time window
docker exec sowel sh -c 'cat /app/data/logs/sowel.6.log | grep -E "2026-04-11T07:" | grep -E "\"level\":\"(error|warn)\""'
```

### Via le script helper

Depuis le repo (sur votre machine de dev) :

```bash
SOWEL_URL=http://<host>:3000 SOWEL_PASSWORD='<pwd>' \
  python3 scripts/logs/fetch-logs.py "" error 100

# Filter by module
SOWEL_URL=http://<host>:3000 SOWEL_PASSWORD='<pwd>' \
  python3 scripts/logs/fetch-logs.py recipe-manager debug 50
```

Cela interroge le **ring buffer** via l'API, donc seulement les logs depuis le dernier redémarrage.

### Augmenter temporairement le niveau de log

```bash
curl -s -X PUT http://<host>:3000/api/v1/logs/level \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"level":"debug"}'
```

Cela n'affecte que le ring buffer (toujours à debug par défaut). Le transport fichier est au niveau racine défini via la variable d'env `LOG_LEVEL`.

---

## Vérification de version

```bash
TOKEN=$(curl -s -X POST http://<host>:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  --data-raw '{"username":"admin","password":"<pwd>"}' | jq -r .accessToken)

curl -s http://<host>:3000/api/v1/system/version \
  -H "Authorization: Bearer $TOKEN" | jq
```

Réponse attendue :

```json
{
  "current": "1.0.8",
  "latest": "1.0.8",
  "updateAvailable": false,
  "releaseUrl": "https://github.com/mchacher/sowel/releases/tag/v1.0.8",
  "dockerAvailable": true,
  "composeManaged": true
}
```

Forcer un poll GitHub frais :

```bash
curl -s -X POST http://<host>:3000/api/v1/system/version/check \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

## Dépannage

### Le conteneur redémarre en boucle

```bash
docker logs --tail 50 sowel
```

Causes courantes :

- Erreur de migration de base de données, cherchez `migration failed` dans les logs
- `/var/run/docker.sock` manquant alors que l'auto-update est activé, devrait simplement warn, pas crasher
- InfluxDB non joignable, vérifiez que `sowel-influxdb` tourne

### L'intégration ne se connecte pas

1. Vérifiez le statut dans UI Admin → Intégrations ou via `GET /api/v1/integrations`
2. Vérifiez les logs pour le module plugin spécifique : `plugin:<id>`
3. Vérifiez que les réglages sont configurés sous `integration.<id>.*` dans la table `settings`

### L'auto-update échoue

Symptômes : clic sur "Update", overlay affiché, mais la page ne recharge jamais. Le conteneur reste sur l'ancienne version.

Récupération :

```bash
cd /opt/sowel
docker compose up -d  # recreates the current container if helper failed mid-way
# Or manual upgrade:
docker compose pull && docker compose up -d
```

Investigation :

- Les logs du conteneur helper sont **perdus** si `AutoRemove: true` (défaut actuel, spec 060)
- Vérifiez les logs propres de sowel juste avant le spawn du helper, `Update helper spawned` est la dernière ligne avant le swap
- Si sowel n'est jamais revenu, vérifiez `docker ps -a` pour voir si le conteneur est en Exited

### Base de données corrompue

SQLite est en mode WAL, sûr en cas d'arrêts brutaux dans la plupart des cas. En cas de corruption :

```bash
# Stop sowel
docker compose stop sowel

# Backup the corrupted DB
docker run --rm -v /opt/sowel_sowel-data:/data alpine cp /data/sowel.db /data/sowel.db.broken

# Restore from the most recent local backup
docker run --rm -v /opt/sowel_sowel-data:/data alpine ls /data/backups/

# Then use the restore flow (see above)
```

### Bucket InfluxDB manquant après restauration

Si vous restaurez sur une machine fraîche, InfluxDB peut ne pas encore avoir de buckets. Le flux de restauration actuel (spec 059) appelle `ensureBuckets()` et `ensureEnergyBuckets()` avant d'écrire les données, donc cela devrait être automatique. Sinon, vérifiez les logs `sowel-influxdb`.

### Logique horaire cassée (volets à la mauvaise heure, HP/HC erroné)

Le conteneur démarre par défaut en UTC. Définissez `TZ=Europe/Paris` (ou votre fuseau) dans `docker-compose.yml` puis redémarrez. Voir [architecture.md § Gestion des fuseaux horaires](architecture.md#gestion-des-fuseaux-horaires-spec-061) et la spec 061 sur [github.com/mchacher/sowel/tree/main/specs/061-timezone-from-home-location](https://github.com/mchacher/sowel/tree/main/specs/061-timezone-from-home-location).

---

## Exemple de déploiement de référence

Un déploiement domestique typique sur un seul hôte ressemble à ceci :

- **Hôte** : n'importe quelle VM Linux ou SBC (x86_64 ou ARM64, 4+ Go RAM recommandés)
- **Chemin** : `/opt/sowel/`
- **Accès** : LAN `http://<votre-hote>:3000`
- **Conteneurs** : `sowel` + `sowel-influxdb`
- **Fuseau** : `TZ=<votre-fuseau>` explicitement défini dans le compose (workaround en attendant la spec 061)
- **Version actuelle** : `docker logs sowel | grep "Sowel engine started"`
- **Backups** : locaux dans `data/backups/` (auto), plus des téléchargements manuels conservés hors de l'hôte
- **MQTT** : `mosquitto` externe tournant sur le même hôte (pas dans le compose), utilisé par les plugins `zigbee2mqtt` et `lora2mqtt`
- **Zigbee2MQTT** : daemon externe sur le même hôte, pas géré par Sowel lui-même

Le graphe de connectivité :

```
         Internet
            |
     Cloudflare Tunnel (optionnel, voir le guide d'accès distant)
            |
     votre-hote (VM Linux)
     +-- docker: sowel           (port 3000)
     +-- docker: sowel-influxdb
     +-- docker: mosquitto       (MQTT broker, 1883)
     +-- systemd: zigbee2mqtt   (lit le coordinateur Zigbee USB)
     +-- systemd: lora2mqtt     (lit le dongle LoRa USB)
     +-- systemd: cloudflared   (tunnel)
```
