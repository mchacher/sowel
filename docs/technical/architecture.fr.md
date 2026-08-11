# Vue d'ensemble de l'architecture

Ce document décrit l'architecture technique de Sowel : la stack technique, la structure du projet, le pipeline réactif, les concepts métier clés, et le design system.

---

## Stack technique

### Backend

| Technologie                  | Rôle                                                 |
| ---------------------------- | ---------------------------------------------------- |
| **Node.js 20+**              | Runtime                                              |
| **TypeScript** (strict mode) | Langage                                              |
| **Fastify**                  | Framework HTTP                                       |
| **SQLite** (better-sqlite3)  | Base de données principale (API synchrone, mode WAL) |
| **InfluxDB 2.x**             | Stockage de séries temporelles (historique, énergie) |
| **ws**                       | Serveur WebSocket                                    |
| **mqtt.js**                  | Client MQTT pour les intégrations device             |
| **pino**                     | Logs JSON structurés                                 |

### Frontend

| Technologie      | Rôle                                                          |
| ---------------- | ------------------------------------------------------------- |
| **React 18+**    | Framework UI                                                  |
| **TypeScript**   | Langage                                                       |
| **Vite**         | Build tool et serveur de développement                        |
| **Tailwind CSS** | Styling (utility classes uniquement, pas de CSS personnalisé) |
| **Zustand**      | Gestion d'état                                                |
| **Lucide React** | Bibliothèque d'icônes (stroke 1.5px)                          |

### Infrastructure

| Technologie                 | Rôle                              |
| --------------------------- | --------------------------------- |
| **Docker + docker-compose** | Déploiement conteneurisé          |
| **PM2**                     | Gestion de processus (production) |

---

## Concepts métier clés

| Terme         | Rôle                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Device**    | Matériel physique, auto-découvert depuis les intégrations. Expose des Data brutes et des Orders.                                         |
| **Equipment** | Unité fonctionnelle visible par l'utilisateur. Se lie à un ou plusieurs Devices. Peut avoir des Data calculées et dispatcher des Orders. |
| **Zone**      | Regroupement spatial (arbre imbriquable). Auto-agrège les Data des Equipments (motion=OR, temperature=AVG, lightsOn=COUNT, etc.).        |
| **Scenario**  | Règle d'automatisation : trigger(s) -> condition(s) -> action(s).                                                                        |
| **Recipe**    | Modèle de Scenario réutilisable avec slots de paramètres typés.                                                                          |
| **Mode**      | État nommé (par ex. "Night", "Away") avec impacts au niveau zone. Activable manuellement, par calendrier, ou par appui sur un bouton.    |

**Principe directeur** : un Device est ce qui est sur le réseau. Un Equipment est ce qui est dans la pièce.

---

## Pipeline réactif

Le flux de données central est entièrement piloté par les événements. Chaque message d'intégration se propage à travers toute la stack :

```
Integration message (MQTT, cloud API poll, etc.)
  -> Integration Plugin (receives + parses)
    -> Device Manager (updates DeviceData)
      -> Event Bus: "device.data.updated"
        -> Equipment Manager (re-evaluates bindings + computed Data)
          -> Event Bus: "equipment.data.changed"
            -> Zone Manager (re-evaluates aggregations)
              -> Event Bus: "zone.data.changed"
                -> Recipe Engine (evaluates triggers -> conditions -> actions)
                  -> Actions may emit Orders -> Integration Plugin -> device
            -> MQTT Publish Service (outbound to external brokers, with optional on-change filter)
            -> Notification Publish Service (Telegram, etc.)
            -> WebSocket pushes to UI clients
```

### Event Bus

Le bus d'événements est un `EventEmitter` typé qui utilise les unions discriminées TypeScript (type `EngineEvent`). C'est la colonne vertébrale qui relie tous les managers. Règles clés :

- Tous les handlers doivent être non bloquants et ne jamais lever d'exception.
- Les événements sont batchés (intervalle de 200 ms) avant d'être envoyés aux clients WebSocket.
- Les événements de données à haute fréquence (`device.data.updated`, `equipment.data.changed`, `zone.data.changed`) sont dédupliqués par batch : seule la dernière valeur par clé est envoyée.

### Types d'événements

| Event                             | Payload                                              | Quand                                       |
| --------------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| `device.discovered`               | `device: Device`                                     | Nouveau device trouvé                       |
| `device.removed`                  | `deviceId, deviceName`                               | Device supprimé                             |
| `device.status_changed`           | `deviceId, deviceName, status`                       | Online/offline                              |
| `device.data.updated`             | `deviceId, deviceName, dataId, key, value, previous` | Changement de propriété                     |
| `equipment.data.changed`          | `equipmentId, key, value, previous`                  | Donnée liée modifiée                        |
| `equipment.order.executed`        | `equipmentId, orderAlias, value, source?`            | Ordre dispatché                             |
| `zone.data.changed`               | `zoneId, key, value, previous`                       | Donnée agrégée modifiée                     |
| `system.started`                  | --                                                   | Démarrage moteur terminé                    |
| `system.integration.connected`    | `integrationId`                                      | Intégration connectée                       |
| `system.integration.disconnected` | `integrationId`                                      | Intégration déconnectée                     |
| `settings.changed`                | `keys`                                               | Réglages mis à jour                         |
| `mode.activated`                  | mode details                                         | Mode activé                                 |
| `mode.deactivated`                | mode details                                         | Mode désactivé                              |
| `recipe.state_changed`            | instance details                                     | État de recette modifié                     |
| `activity.added`                  | `item: ActivityItem`                                 | Nouvel item d'activité bufferisé (spec 101) |

---

## Structure du projet

```
sowel/
├── src/
│   ├── index.ts                 # Entry point
│   ├── config.ts                # Env config loading
│   ├── core/                    # event-bus, database (SQLite), influx, logger, settings-manager
│   ├── integrations/            # Integration plugins (zigbee2mqtt, panasonic-cc, mcz-maestro, ...)
│   ├── plugins/                 # Plugin manager (third-party plugin loading)
│   ├── devices/                 # Device manager, auto-discovery, category inference
│   ├── equipments/              # Equipment manager, bindings, computed engine, order dispatcher
│   ├── energy/                  # Energy aggregator, tariff classifier (HP/HC)
│   ├── zones/                   # Zone manager, auto-aggregation engine
│   ├── modes/                   # Mode manager, calendar manager
│   ├── recipes/                 # Recipe engine, built-in recipes (motion-light, switch-light)
│   ├── buttons/                 # Button action bindings (physical button -> mode/order)
│   ├── charts/                  # Saved chart configurations
│   ├── history/                 # InfluxDB history writer and query helpers
│   ├── mqtt-publishers/         # Outbound MQTT publishing (broker manager, publisher manager, on-change filter)
│   ├── notifications/           # Notification channels (Telegram, etc.)
│   ├── ai/                      # LLM integration (Claude/OpenAI/Ollama) -- V1.0+
│   ├── auth/                    # JWT + API tokens, middleware, first-run setup
│   ├── users/                   # User CRUD, preferences
│   ├── api/                     # Fastify server, WebSocket handler, route files
│   │   ├── server.ts            # Server setup and route registration
│   │   ├── websocket.ts         # WebSocket handler with topic subscriptions
│   │   └── routes/              # One file per domain (auth, devices, zones, etc.)
│   └── shared/                  # types.ts (all interfaces), constants.ts
├── ui/                          # React frontend (separate Vite project)
│   └── src/
│       ├── store/               # Zustand stores (devices, equipments, zones, WebSocket)
│       ├── components/          # By domain: dashboard/, devices/, equipments/, zones/, scenarios/
│       ├── pages/               # Dashboard, Devices, Equipments, Zones, Scenarios, Settings
│       └── i18n/                # Internationalization (en.json, fr.json)
├── plugins/                     # Third-party plugin install directory
├── recipes/                     # Built-in Recipe JSON templates
├── migrations/                  # SQLite migration SQL files
├── specs/                       # Feature specifications (XXX-version-name/)
└── scripts/                     # Maintenance & diagnostic scripts
    ├── energy/                  # InfluxDB energy backfill, diagnostic, admin
    └── logs/                    # Log retrieval via API
```

---

## Architecture Plugin V2 (actuelle)

Depuis la spec 053, **toutes les intégrations et recettes sont des plugins** distribués via GitHub. Plus rien n'est intégré nativement, une installation Sowel fraîche n'a aucun plugin et les télécharge à la demande depuis un registre.

### Services centraux

| Service                 | Fichier                                    | Rôle                                                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PackageManager**      | `src/packages/package-manager.ts`          | Télécharge, installe, met à jour et supprime les packages (intégrations + recettes). Récupère les manifests depuis les releases GitHub. Tient l'état en base dans la table `plugins`.                                                                          |
| **PluginLoader**        | `src/plugins/plugin-loader.ts`             | Loader spécifique aux intégrations. Importe l'entrée JS du plugin (`dist/index.js`), appelle `createPlugin`, enregistre dans `IntegrationRegistry`. Auto-télécharge les fichiers du plugin au démarrage si manquants (par ex. après restauration d'un backup). |
| **RecipeLoader**        | `src/recipes/recipe-loader.ts`             | Loader spécifique aux recettes. Même modèle que PluginLoader mais pour les paquets de recettes.                                                                                                                                                                |
| **IntegrationRegistry** | `src/integrations/integration-registry.ts` | Registre runtime des intégrations connectées. Gère les start/stop avec staggering (pour éviter les appels simultanés aux APIs cloud).                                                                                                                          |

### Modèle de distribution

Les plugins vivent dans des repos GitHub séparés (par ex. `mchacher/sowel-plugin-zigbee2mqtt`). Chaque release embarque un tarball pré-compilé. Le **registre**, la liste des packages disponibles, est récupéré depuis :

- **Distant** : `https://raw.githubusercontent.com/mchacher/sowel/main/plugins/registry.json` (TTL de cache 1 h)
- **Fallback** : `plugins/registry.json` local livré dans l'image Docker

Flux d'installation :

1. L'utilisateur clique sur "Installer" dans l'UI Admin → Plugins
2. PackageManager appelle l'API releases GitHub du repo du plugin
3. Télécharge le tarball de la dernière release et le manifest
4. Extrait dans `plugins/<id>/` sur le volume `sowel-plugins`
5. Insère une ligne dans la table SQLite `plugins`
6. PluginLoader importe l'entrée et enregistre l'intégration

Le `plugins/registry.json` sur `main` est la source de vérité pour la liste officielle. N'importe quel utilisateur peut pointer vers son propre fork.

### Niveaux de confiance (specs 089 + 136)

Trois niveaux de confiance déterminent d'où un package peut provenir et quelle ancre d'intégrité le protège :

| Niveau            | Source de vérité                      | Ancre d'intégrité                     | Friction à l'installation                     |
| ----------------- | ------------------------------------- | ------------------------------------- | --------------------------------------------- |
| **Officiel**      | Registre central, owner whitelisté    | SHA256 du registre + revue mainteneur | Aucune                                        |
| **Communautaire** | Registre central, owner tiers         | SHA256 du registre + revue de la PR   | Modal de confirmation unique                  |
| **Personnel**     | Dépôt GitHub ajouté par l'admin (136) | SHA256 épinglé (TOFU)                 | Confirmation à l'installation et à chaque MAJ |

Les **sources personnelles** (spec 136) permettent à un admin d'enregistrer ses propres dépôts GitHub publics comme sources de plugins, sans passer par le registre central. `PersonalSourceManager` (`src/packages/personal-sources.ts`) possède la table `plugin_sources` et une vue en cache de la dernière release de chaque dépôt. La confiance est au premier usage : l'installation télécharge le tarball, affiche son SHA256 dans un modal de confirmation, puis épingle le hash dans `plugins.pinned_sha256`. Les mises à jour dont le tarball diffère du hash épinglé exigent une nouvelle confirmation ; les restaurations de backup revérifient les téléchargements contre le hash épinglé. Tout le durcissement de la spec 089 (vérification du hash, flags tar, refus des symlinks sortants) s'applique à l'identique, plus des contrôles propres au niveau personnel : le `repo` du manifest doit correspondre à la source, l'id du plugin ne doit pas masquer un id du registre, et la compatibilité `sowelVersion` est vérifiée. Les packages installés portent `plugins.source` (`registry` ou `personal`) ; la détection de version des packages personnels lit les releases du dépôt source, jamais le registre.

### Format du manifest plugin

Chaque plugin embarque un `manifest.json` avec `id`, `type` (`integration` ou `recipe`), `name`, `description`, `icon` (nom Lucide), `author`, `repo`, `version`, `tags`. Voir [plugin-development.md](plugin-development.md) pour la spec complète.

### Cycle de vie d'une intégration

1. **Load** : `PluginLoader.loadAll()` parcourt la table `plugins`, importe chaque entrée activée, appelle `createPlugin(deps)`, enregistre dans `IntegrationRegistry`.
2. **Start** : `IntegrationRegistry.startAll()` démarre les plugins séquentiellement avec de petits délais. Le `start()` de chaque plugin se connecte, découvre les devices, démarre le polling.
3. **Runtime** : le plugin pousse les données via `deviceManager.updateDeviceData()`. Les ordres sortent via `plugin.executeOrder()`.
4. **Stop** : `stop()` annule les timers, ferme les connexions.
5. **Update** : Unload → `PackageManager.updateFiles()` → reload.
6. **Uninstall** : Unload → `PackageManager.removeFiles()`.

Les réglages d'intégration sont stockés en SQLite dans `settings` sous `integration.<id>.<key>`, configurés depuis l'UI.

### Écosystème actuel des plugins officiels

| Plugin                  | Repo                                          | Type        |
| ----------------------- | --------------------------------------------- | ----------- |
| `zigbee2mqtt`           | `mchacher/sowel-plugin-zigbee2mqtt`           | integration |
| `lora2mqtt`             | `mchacher/sowel-plugin-lora2mqtt`             | integration |
| `panasonic_cc`          | `mchacher/sowel-plugin-panasonic-cc`          | integration |
| `mcz_maestro`           | `mchacher/sowel-plugin-mcz-maestro`           | integration |
| `legrand_control`       | `mchacher/sowel-plugin-legrand-control`       | integration |
| `legrand_energy`        | `mchacher/sowel-plugin-legrand-energy`        | integration |
| `netatmo_weather`       | `mchacher/sowel-plugin-netatmo-weather`       | integration |
| `netatmo-security`      | `mchacher/sowel-plugin-netatmo-security`      | integration |
| `weather-forecast`      | `mchacher/sowel-plugin-weather-forecast`      | integration |
| `smartthings`           | `mchacher/sowel-plugin-smartthings`           | integration |
| `motion-light`          | `mchacher/sowel-recipe-motion-light`          | recipe      |
| `motion-light-dimmable` | `mchacher/sowel-recipe-motion-light-dimmable` | recipe      |
| `switch-light`          | `mchacher/sowel-recipe-switch-light`          | recipe      |
| `presence-heater`       | `mchacher/sowel-recipe-presence-heater`       | recipe      |
| `presence-thermostat`   | `mchacher/sowel-recipe-presence-thermostat`   | recipe      |
| `state-watch`           | `mchacher/sowel-recipe-state-watch`           | recipe      |
| `state-trigger-light`   | `mchacher/sowel-recipe-state-trigger-light`   | recipe      |

La liste live est dans `plugins/registry.json` à la racine du repo.

---

## Architecture base de données

### SQLite

- **Bibliothèque** : `better-sqlite3` avec API volontairement synchrone (rapide, pas de surcharge de callbacks).
- **Mode WAL** : `PRAGMA journal_mode=WAL` pour la lecture/écriture concurrente.
- **Migrations** : fichiers SQL dans `migrations/` exécutés automatiquement au démarrage.
- **Transactions** : utilisées pour les opérations en lot.
- **IDs** : UUID v4 via `crypto.randomUUID()`.
- **Dates** : format ISO 8601 partout.

### InfluxDB

Les données d'énergie et d'historique transitent dans un pipeline multi-buckets :

```
sowel (raw)              -- 7-day retention  -- raw data points
  | task: sowel-energy-sum-hourly (every: 1h, lookback: -7h)
sowel-energy-hourly      -- 2-year retention -- hourly sums
  | task: sowel-energy-sum-daily (every: 1d, lookback: -2d)
sowel-energy-daily       -- 10-year retention -- daily sums
```

Des buckets downsamplés supplémentaires (`sowel-hourly`, `sowel-daily`) existent pour les séries temporelles non énergétiques.

InfluxDB est obligatoire : Sowel se connecte au démarrage et auto-crée les buckets, les tâches de downsampling, et les tâches d'agrégation énergétique.

#### Les deltas d'énergie sont cumulés, jamais échantillonnés

Un binding `energy` porte un **delta additif** (Wh depuis le tick précédent), pas une mesure. La déduplication qui protège les autres catégories (deadband, intervalle minimum de 30 s) détruirait silencieusement de l'énergie : les compteurs ont des cadences très différentes — un Shelly EM émet un tick par minute, un Tuya PJ-1203A en émet ~30, dont un seul porte le saut de compteur de 10 Wh.

Le `HistoryWriter` cumule donc les ticks `energy` temps réel sur la minute et écrit un point unique aligné sur le début de minute, découpage HP/HC compris. Le `SelfConsumptionWriter` cumule de la même façon la minute appairée Réseau + Solaire et en dérive `autoconso` / `injection` / consommation foyer.

#### Un seul écrivain par série

Les deux writers ferment leur bucket de minute sur des déclencheurs différents : le `HistoryWriter` par binding, le `SelfConsumptionWriter` au premier tick de la minute suivante venant de l'un ou l'autre compteur. Partager une série entre eux serait donc une course au dernier écrivain, arbitrée par le compteur qui émet le premier. La propriété des séries `energy` / `energy_hp` / `energy_hc` du compteur réseau est de ce fait exclusive :

- **Avec un `energy_production_meter` configuré**, le `SelfConsumptionWriter` en est le seul écrivain (sémantique foyer), et le `HistoryWriter` ignore exactement ces trois alias sur le `main_energy_meter`. Il continue d'écrire tout le reste : puissance, tension, `energy_forward` / `energy_reverse`, tous les sous-compteurs, et l'énergie propre du compteur solaire.
- **Réseau seul (pas de compteur de production)**, le `SelfConsumptionWriter` est inerte et le `HistoryWriter` écrit l'énergie réseau cumulée brute, comme avant.

La propriété suit le cache d'équipements : ajouter ou retirer le compteur de production à chaud transfère la série sans redémarrage.

Deux conséquences à connaître :

- Toute minute ayant vu un tick réseau est écrite. Une minute sans tick solaire n'est pas un trou : c'est un import réseau pur (`autoconso = 0`). Seule une minute solaire-seule est abandonnée — l'injection est indéfinie sans le côté réseau.
- Les ticks porteurs d'un `sourceTimestamp` explicite (plugins publiant des fenêtres historiques alignées, ex. fenêtres 30 min Netatmo/Legrand) sont déjà agrégés : le `HistoryWriter` les écrit tels quels et le découpage HP/HC est classifié sur 30 minutes, et non sur les 60 s d'un bucket temps réel.

---

## Authentification et autorisation

- **Mots de passe** : bcrypt (cost 12).
- **JWT** : HS256 via `jsonwebtoken`. TTL access token : 15 min. TTL refresh token : 30 jours.
- **Tokens d'API** : préfixe `swl_`, hash SHA-256 stocké, généré via `crypto.randomBytes(32)`. Préfixes legacy `wch_` et `cbl_` aussi acceptés.
- **Middleware d'auth** : tente d'abord le décodage JWT, puis le lookup de token d'API.
- **Rôles** : `admin` > `standard` > `viewer` (permissions hiérarchiques).
- **Setup au premier démarrage** : `POST /api/v1/auth/setup` crée le premier utilisateur admin.

---

## Architecture frontend

### Gestion d'état

- Stores **Zustand** par domaine : devices, equipments, zones, modes, recipes, etc.
- Les stores sont mis à jour en temps réel par les événements **WebSocket**.
- WebSocket auto-reconnect avec récupération d'état (incrémentale ou complète).

### Styling

- **Tailwind CSS utility classes uniquement**, pas de fichiers CSS personnalisés.
- Design responsive **mobile-first** (breakpoints : 640 px, 1024 px).
- **Dark mode** via la stratégie `class` de Tailwind, indispensable pour un usage de tableau de bord la nuit.

### Internationalisation

- Anglais et français pris en charge.
- Fichiers de locale : `ui/src/i18n/locales/en.json`, `ui/src/i18n/locales/fr.json`.
- Les traductions de recettes voyagent avec la classe de la recette (voir le champ `i18n`), pas dans les fichiers de locale de la plateforme.

---

## Design system

| Propriété                 | Valeur                                                       |
| ------------------------- | ------------------------------------------------------------ |
| **Police body**           | Inter                                                        |
| **Police mono**           | JetBrains Mono (valeurs, logs)                               |
| **Couleur primaire**      | `#1A4F6E` (ocean blue), hover : `#13405A`, light : `#E6F0F6` |
| **Couleur accent**        | `#D4963F` (amber), hover : `#BB8232`                         |
| **Espacement de base**    | 4px                                                          |
| **Border radius**         | 6px (boutons), 10px (cartes), 14px (modales)                 |
| **Taille de police body** | 14px (tableau de bord dense)                                 |
| **Valeurs de données**    | 28px (lisibles d'un coup d'œil)                              |
| **Icônes**                | Lucide React, stroke 1.5px                                   |

---

## Backup et restauration

Les backups capturent l'état complet du système dans une seule archive ZIP et le restaurent atomiquement.

### Service

`BackupManager` dans `src/backup/backup-manager.ts` est le service central. Il est appelé par :

- **Routes HTTP** `GET/POST /api/v1/backup` (export/import manuel)
- **UpdateManager** (backup automatique pré-update, voir la section auto-update)
- **Routes de backup local** `GET /api/v1/backup/local`, `POST /api/v1/backup/restore-local`

### Format d'archive

Un ZIP de backup contient :

| Entrée                    | Contenu                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `sowel-backup.json`       | Export SQLite en JSON, structuré par table (format version 2)                                                    |
| `influx-raw.lp`           | Données InfluxDB brutes en line protocol (7 derniers jours)                                                      |
| `influx-hourly.lp`        | Données horaires downsamplées (90 derniers jours)                                                                |
| `influx-daily.lp`         | Données journalières downsamplées (5 dernières années)                                                           |
| `influx-energy-hourly.lp` | Sommes énergétiques horaires (2 dernières années)                                                                |
| `influx-energy-daily.lp`  | Sommes énergétiques journalières (10 dernières années)                                                           |
| `data/*`                  | Tous les fichiers non DB de `data/` (secrets de tokens, etc.), scannés dynamiquement, hors `.db`, `.pid`, `.log` |

L'export JSON SQLite couvre une liste sélectionnée de tables (constante `BACKUP_TABLES` dans `backup-manager.ts`) dans l'ordre des dépendances (parents d'abord pour la restauration).

### Backups locaux (data/backups/)

Distinct de l'export manuel, `BackupManager.exportToFile()` écrit les backups dans `data/backups/sowel-backup-<name>.zip` sur le volume persistant. Utilisé par :

- **UpdateManager** avant tout self-update : `data/backups/sowel-backup-pre-v<version>-<timestamp>.zip`
- **Rotation** via `rotateLocalBackups(keep)`, conserve uniquement les N fichiers les plus récents

L'UI (Admin → Backup) liste les backups locaux et propose une restauration en un clic via `POST /api/v1/backup/restore-local { filename }`.

### Flux de restauration

1. Valide la structure du ZIP et le schéma JSON
2. Désactive les contraintes FK (hors transaction, limitation SQLite)
3. Supprime toutes les lignes en ordre inverse des dépendances (enfants d'abord)
4. Insère les nouvelles lignes en ordre parent-first
5. Exécute `PRAGMA foreign_key_check`, abandonne la transaction si violations
6. S'assure que les buckets InfluxDB existent (`influxClient.ensureBuckets()` et `ensureEnergyBuckets()`)
7. POST chaque fichier `.lp` vers InfluxDB `/api/v2/write` par batches de 5000 lignes
8. Restaure les fichiers de données dynamiques
9. Répond `restartRequired: true`, l'utilisateur doit redémarrer Sowel pour recharger l'état

Voir la spec 060 pour le dernier design de backup et `src/backup/backup-manager.ts` pour l'implémentation.

---

## Auto-update (spec 060)

Sowel peut se mettre à jour depuis l'UI quand il tourne sous `docker compose`. Le design contourne le paradoxe "le processus se tue lui-même" via un pattern de container helper (similaire à Watchtower).

### Détection

`VersionChecker` dans `src/core/version-checker.ts` interroge `https://api.github.com/repos/mchacher/sowel/releases/latest` toutes les heures (et aussi à T+10s après le boot). Quand un semver plus récent est trouvé, il émet `system.update.available` sur l'EventBus, qui est diffusé aux clients UI via WebSocket. L'UI affiche un badge en temps réel. Un bouton manuel "Check now" appelle `POST /api/v1/system/version/check` qui force un poll immédiat.

`GET /api/v1/system/version` retourne `{ current, latest, updateAvailable, releaseUrl, dockerAvailable, composeManaged }`. `composeManaged` est dérivé des labels du conteneur en cours (`com.docker.compose.*`) ; s'ils sont absents, l'auto-update est désactivé avec un tooltip.

### Flux de mise à jour

`UpdateManager` dans `src/core/update-manager.ts` orchestre la mise à jour :

1. **Backup pré-update** via `backupManager.exportToFile()` → `data/backups/sowel-backup-pre-v<X>-<ts>.zip`
2. **Rotation des backups** (conserve les 3 plus récents)
3. **Détection du contexte compose** depuis les labels du conteneur courant : `com.docker.compose.project.working_dir`, `com.docker.compose.project`, `com.docker.compose.service`
4. **Spawn d'un container helper** via dockerode :
   - Image : `docker:25-cli` (intègre `docker compose`)
   - Mounts : `/var/run/docker.sock` + le compose working dir comme `/workdir`
   - Cmd : `sh -c "sleep 5 && docker compose pull <service> && docker compose up -d <service>"`
   - `AutoRemove: true`
5. **Retour immédiat de l'API**, le helper survit à la mort de Sowel
6. **L'UI affiche un overlay** ("Updating...") pendant le swap, poll `/system/version` toutes les 3 s
7. **Au changement de version** → `window.location.reload()`

Pourquoi un helper ? Appeler `dockerode.stop()` sur le conteneur en cours depuis le processus en cours tue le runtime Node via SIGTERM avant que la séquence remove/create/start puisse s'exécuter. Le helper est un processus séparé dans un conteneur séparé qui survit au swap.

**Prérequis sur l'hôte** :

- `/var/run/docker.sock` monté dans le conteneur sowel
- Le compose working dir doit être accessible depuis le système de fichiers de l'hôte (n'importe quel chemin de bind mount fonctionne, Sowel le lit depuis les labels du conteneur)
- `docker compose up` doit utiliser un nom de fichier standard `docker-compose.yml` / `compose.yml` (les noms non standards nécessitent `-f`, pas géré actuellement)

---

## CI/CD et releases (spec 055)

### Workflow GitHub Actions

`.github/workflows/release.yml` se déclenche sur les tags poussés correspondant à `v*`. Il exécute :

1. **job ci** : typecheck, lint, tests (backend + UI)
2. **job docker** : build l'image `linux/amd64` avec Buildx, pousse vers `ghcr.io/mchacher/sowel:<version>` et `:latest`, puis crée une GitHub Release avec des notes auto-générées

Le build Docker est **amd64-only** (spec simplifiée en avril 2026 pour des builds environ 3x plus rapides ; arm64 abandonné car aucun utilisateur ne tourne sur des hôtes Linux Apple Silicon en production).

### Script de release

`scripts/release.sh <version>` :

1. Valide le format semver et un working tree propre
2. Bump les versions de `package.json` + `ui/package.json`
3. Lance la validation complète (`npm run validate`)
4. Commit `release: vX.Y.Z`, tag `vX.Y.Z`, push vers origin
5. GitHub Actions prend le relais

Une skill Claude Code emballe ça dans `.claude/skills/sowel-release/SKILL.md`.

### Image Docker (`Dockerfile`)

Build multi-étages :

1. **backend-build** : Node 20, `tsc` backend
2. **ui-build** : Node 20, build Vite UI
3. **runtime** : Debian Trixie (pour Python 3.13), Node 20 installé via NodeSource, Python 3.13 + venv pour les plugins qui en ont besoin (par ex. Panasonic CC), `better-sqlite3` recompilé pour la plateforme

L'image runtime fait environ 950 Mo non compressée (environ 210 Mo de contenu). L'exigence Python 3.13 vient du plugin Panasonic CC qui a besoin d'une syntaxe f-string indisponible en Python 3.11.

---

## Activity Buffer (spec 101)

`src/activity/activity-buffer.ts` garde les **dernières 24 heures** d'événements moteur (filtrés et enrichis pour la vue zone) dans un ring buffer en mémoire unique (plafonné à 2000 items). Il alimente le panneau **Activité** dans la vue zone ([guide utilisateur](../user/zones.md#fil-dactivite)).

### Flux d'événements

1. Le buffer souscrit à un sous-ensemble curé d'`EngineEvent`s : `equipment.order.executed`, `equipment.data.changed` (filtré sur la catégorie de binding `motion`, `water_leak`, `smoke`), `recipe.instance.started/stopped/error`, `mode.activated/deactivated`, `sunlight.changed`, `system.alarm.raised`.
2. Pour chaque événement, il résout le nom d'équipement / de recette et le `zoneId` pertinent via les managers (equipment, recipe, zone, sunlight), puis construit un `ActivityItem`.
3. Il pousse l'item dans le ring buffer (cap par count, purge des entrées dépassant le TTL) et émet un événement `activity.added` sur le bus.
4. La couche WebSocket diffuse cet événement aux clients abonnés au topic `activity`. Les clients bootstrapent également via `GET /api/v1/activity` au montage.

### Attribution des sources

`executeOrder()` accepte un 4e argument optionnel `source` de type `OrderSource`. Le SDK des recettes expose un closure `ctx.dispatchOrder()` par instance qui pré-lie le `source` de la recette, ce qui évite aux helpers internes d'avoir à threader `source` eux-mêmes. Les modes, les bindings de boutons et les routes API passent le source inline. Les plugins de recettes externes continuent de fonctionner sans attribution (dégradation gracieuse).

### Empreinte mémoire

À environ 400 octets par item, 2000 items représentent environ 800 Ko, soit moins de 0,3 % du RSS d'un conteneur Sowel typique. Le buffer est perdu au redémarrage du conteneur, comme le ring buffer des logs.

---

## Logging

### Stratégie

Logs JSON structurés pino avec sortie multistream (voir `src/core/logger.ts`) :

- **Ring buffer** : buffer circulaire en mémoire pour le viewer de logs de l'UI (capture toujours au niveau debug)
- **stdout** : JSON brut en production (capté par les Docker logs), pino-pretty en développement
- **Transport fichier** : en production uniquement, via `pino-roll` vers `data/logs/sowel.<yyyy-MM-dd>.N.log`, rotation journalière, conserve 14 fichiers (la rétention couvre aussi les fichiers laissés par les conteneurs précédents)

### Emplacement des fichiers de log

`/app/data/logs/sowel.<yyyy-MM-dd>.N.log` à l'intérieur du conteneur (sur le volume `sowel-data`). Un jour calendaire correspond à un fichier prévisible, même après redémarrages et auto-mises à jour. **Survit à la recréation du conteneur**, indispensable pour l'investigation post-incident après une auto-mise à jour.

Exemple de récupération :

```bash
docker exec sowel sh -c 'cat /app/data/logs/sowel.2026-04-11.1.log | grep -E "2026-04-11T07:" | grep error'
```

Avant la v1.39, les fichiers étaient nommés `sowel.N.log` avec un numéro de rotation choisi par processus : plusieurs redémarrages dans la journée éclataient les plages horaires entre fichiers, et un même fichier pouvait couvrir plusieurs mois. Pour investiguer un incident antérieur au changement de format, grepper TOUS les fichiers `sowel.*.log` plutôt que de se fier à un seul. Les anciens fichiers numérotés sont invisibles pour la nouvelle rétention : le moteur les purge automatiquement au démarrage dès qu'ils ont plus de 14 jours, aucune action manuelle n'est nécessaire.

### Conseils sur les niveaux de log

| Niveau  | Usage                                                              |
| ------- | ------------------------------------------------------------------ |
| `fatal` | Crash de processus imminent                                        |
| `error` | Opération échouée, le moteur continue (toujours avec `{ err }`)    |
| `warn`  | Dégradation auto-réparable (reconnexion, données obsolètes)        |
| `info`  | Événements métier significatifs, un par opération                  |
| `debug` | Détail de dépannage pour les développeurs                          |
| `trace` | Chemin chaud à haut volume (chaque événement, chaque message MQTT) |

Conventions :

- Chaque module crée un child logger avec `{ module: "module-name" }`
- Contexte structuré comme premier argument objet : `logger.info({ deviceId, status }, "Device status changed")`
- Mots de passe/tokens/secrets sont auto-redactés par la config pino
- **N'utilisez jamais `console.*`**, ça contourne le ring buffer, la rotation des fichiers et la redaction

### Helpers de récupération

- **Depuis l'UI** : page Admin → Logs (lit le ring buffer)
- **Via API** : `GET /api/v1/logs?module=X&level=Y&limit=N` (ring buffer uniquement, perdu au redémarrage)
- **Depuis le fichier** : `docker exec` dans `/app/data/logs/sowel.*.log` (persistant)
- **Script helper** : `scripts/logs/fetch-logs.py <module> <level> <limit>` avec les variables d'env `SOWEL_URL` + `SOWEL_PASSWORD`

---

## Gestion des fuseaux horaires (spec 061)

La logique backend de Sowel dépend fortement de l'heure locale : créneaux cron du calendrier (`croner`), classification tarifaire HP/HC énergie, frontières de jour énergétique, affichage des levers/couchers de soleil, notifications. Tout utilise les méthodes natives `Date` qui dépendent de `process.env.TZ`.

### Stratégie de détection

Au démarrage, `src/core/timezone.ts` détermine le fuseau horaire avec cette priorité :

1. **Variable d'env `TZ`** : si elle est définie dans `docker-compose.yml` ou dans l'env de l'hôte, Sowel la respecte (l'override explicite l'emporte)
2. **`home.latitude` / `home.longitude`** : si elles sont configurées dans les Réglages, Sowel les passe à `tz-lookup` pour dériver le nom IANA du fuseau (par ex. `Europe/Paris`)
3. **Fallback UTC** : avec un log WARN bruyant invitant l'utilisateur à configurer une localisation maison

`process.env.TZ` est défini **avant `createLogger()`** dans `src/index.ts`. C'est crucial : le premier appel `new Date()` de pino met en cache le TZ dans V8, et les changements de `process.env.TZ` après ça n'ont aucun effet sur les méthodes `Date.prototype` déjà chargées. Voir la séquence de boot dans `src/index.ts`.

### Redémarrage requis après changement de localisation

Node met le TZ en cache à la première utilisation. Si l'utilisateur change `home.latitude` / `home.longitude` dans les Réglages au runtime :

1. La route des réglages logge un warn et émet `system.restart_required` sur l'EventBus
2. L'UI reçoit l'événement via WebSocket et affiche `RestartToast` avec un bouton "Redémarrer maintenant"
3. Cliquer sur le bouton appelle `POST /api/v1/system/restart` qui spawne un container helper `docker:25-cli` (même pattern que la spec 060 self-update) qui exécute `docker compose up -d sowel`
4. Le helper survit à la mort de Sowel et recrée le conteneur, qui prend la nouvelle env et ré-exécute `detectTimezone()` avec les nouvelles coordonnées
5. L'`UpdateOverlay` existant recharge l'UI à la reconnexion WS

### Exposition du TZ dans l'UI

- `GET /api/v1/system/timezone` retourne `{ tz, source, offsetHours }` à tout utilisateur authentifié
- `ui/src/store/useTimezone.ts` met le résultat en cache dans un store Zustand, fetché une fois au montage de l'app depuis `AppLayout.tsx`
- La section Réglages → Maison affiche le TZ en lecture seule avec son label de source (auto / env / fallback)
- La `CurrentTimePill` dans le bandeau d'en-tête affiche l'heure de la **maison** (pas l'heure locale du navigateur), calculée via `Intl.DateTimeFormat(undefined, { timeZone: tz, ... })`, utile quand on accède à Sowel depuis un appareil dans un autre fuseau

Voir la spec 061 sur [github.com/mchacher/sowel/tree/main/specs/061-timezone-from-home-location](https://github.com/mchacher/sowel/tree/main/specs/061-timezone-from-home-location).

---

## Variables d'environnement

Tous les réglages sont optionnels avec des valeurs par défaut raisonnables, Sowel tourne sans configuration prête à l'emploi. Surchargez via `.env` au besoin :

| Variable          | Défaut                         | Notes                                                                                      |
| ----------------- | ------------------------------ | ------------------------------------------------------------------------------------------ |
| `SQLITE_PATH`     | `./data/sowel.db`              | Chemin de la base SQLite                                                                   |
| `API_PORT`        | `3000`                         | Port du serveur HTTP                                                                       |
| `API_HOST`        | `0.0.0.0`                      | Adresse de bind                                                                            |
| `JWT_SECRET`      | auto-généré                    | Persisté dans `data/.jwt-secret` au premier lancement                                      |
| `JWT_ACCESS_TTL`  | `900`                          | TTL de l'access token en secondes (15 min)                                                 |
| `JWT_REFRESH_TTL` | `2592000`                      | TTL du refresh token en secondes (30 jours)                                                |
| `LOG_LEVEL`       | `info`                         | Niveau de log pino                                                                         |
| `CORS_ORIGINS`    | `*`                            | Origines autorisées séparées par des virgules                                              |
| `INFLUX_URL`      | `http://localhost:8086`        | URL InfluxDB 2.x                                                                           |
| `INFLUX_TOKEN`    | auto-généré                    | Persisté dans `data/.influx-token` au premier lancement                                    |
| `INFLUX_ORG`      | `sowel`                        | Organisation InfluxDB                                                                      |
| `INFLUX_BUCKET`   | `sowel`                        | Bucket principal InfluxDB                                                                  |
| `TZ`              | défaut système (UTC en Docker) | Fuseau IANA. À fixer explicitement dans docker-compose pour fiabiliser la logique horaire. |

Les réglages d'intégration (MQTT, identifiants cloud, intervalles de polling) sont configurés depuis l'UI, pas depuis `.env`.
