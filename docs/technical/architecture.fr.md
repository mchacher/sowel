# Vue d'ensemble de l'architecture

Ce document décrit l'architecture technique de Sowel : la stack technique, la structure du projet, le pipeline réactif, les concepts métier clés, et le design system.

---

## Stack technique

### Backend

| Technologie                  | Rôle                                                 |
| ---------------------------- | ---------------------------------------------------- |
| **Node.js 24+**              | Runtime                                              |
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
│   ├── shared-access/           # Accès partagés (spec 181) : codes et liens qui ouvrent un portail, page publique
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
2. **Start** : `IntegrationRegistry.startAll()` démarre les plugins séquentiellement avec de petits délais. Le `start()` de chaque plugin se connecte, découvre les devices, démarre le polling. Le retour de `start()` ne signifie **pas** que le plugin est joignable : les connexions MQTT et les authentifications cloud se terminent ensuite, de façon asynchrone.
3. **Connected** : le registre échantillonne le `getStatus()` de chaque plugin et émet `system.integration.connected` / `system.integration.disconnected` à chaque transition. C'est le signal du moteur lui-même, indépendant de ce qu'un plugin choisit d'émettre, et c'est lui qui rend observable le retour d'une intégration (voir [Livraison des ordres](#livraison-des-ordres-quand-une-integration-est-injoignable) ci-dessous).
4. **Runtime** : le plugin pousse les données via `deviceManager.updateDeviceData()`. Les ordres sortent via `plugin.executeOrder()`.
5. **Stop** : `stop()` annule les timers, ferme les connexions.
6. **Update** : Unload → `PackageManager.updateFiles()` → reload.
7. **Uninstall** : Unload → `PackageManager.removeFiles()`.

Les réglages d'intégration sont stockés en SQLite dans `settings` sous `integration.<id>.<key>`, configurés depuis l'UI.

#### Livraison des ordres quand une intégration est injoignable

Un ordre envoyé vers une intégration déconnectée n'atteint jamais le fil. Plutôt que d'être jeté avec une ligne de log, il est retenu par le tracker de confirmation d'ordre (spec 141) et rejoué **une fois** quand cette intégration se connecte, dans une fenêtre courte : une commande planifiée rejouée longtemps après son créneau serait pire que celle qui a été perdue. L'appelant reçoit toujours la même erreur qu'avant.

Les instances de recettes sont la raison pour laquelle cela se produisait à chaque redémarrage : elles démarrent tout à la fin du boot, derrière une attente bornée sur la connexion des intégrations, car une instance évalue et envoie des ordres dès son démarrage. L'attente est plafonnée pour qu'une intégration cloud injoignable ne bloque pas tous les automatismes, et ce qui passe malgré tout est rattrapé par la rétention décrite ci-dessus. L'API et la liste des recettes n'attendent pas ; seul l'état des instances en cours d'exécution attend.

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

La pluie est sommée depuis `sowel-hourly` (le bucket journalier ne stocke que des moyennes), conservé 90 jours. Pour remonter plus loin (spec 186), un bucket dédié garde les mêmes points horaires pendant un an :

```
sowel-hourly             -- rétention 90 jours -- moyennes horaires (pluie : mm par heure)
  | tâche : sowel-rain-copy-hourly (every: 1h, offset: 5m, 24 dernières heures, copiées telles quelles)
  | + rattrapage de tout ce que contient sowel-hourly à chaque démarrage (idempotent)
sowel-rain-hourly        -- rétention 1 an -- moyennes horaires de pluie, mêmes tags et horodatages
```

Une requête de pluie lit les deux buckets, garde un point par heure, puis somme par heure ou par jour local au moment de la requête. On stocke des heures et non des jours : rien de ce qui est stocké ne dépend du fuseau, et changer `TZ` ou l'emplacement de la maison redécoupe les jours à la lecture suivante. Si `sowel-rain-hourly` est illisible, la requête se rabat sur `sowel-hourly` seul.

Une heure de pluie qui arrive une fois terminée (relevé en retard ou rattrapage d'un plugin, `sourceTimestamp` antérieur à l'heure en cours) est écrite par le writer d'historique directement dans `sowel-hourly` et `sowel-rain-hourly`, chacun dans sa rétention, horodatée à la fin de l'heure comme le downsampling (#1036) ; au-delà de la rétention du bucket brut, elle n'y est pas écrite.

InfluxDB est obligatoire : Sowel se connecte au démarrage et auto-crée les buckets, les tâches de downsampling, et les tâches d'agrégation énergétique.

#### Où l'effet d'un ordre est observé

Un `executeOrder` qui réussit signifie que l'ordre a atteint l'intégration, pas que l'appareil a agi : le tracker guette donc l'apparition de la valeur ordonnée et alerte si elle ne vient pas. La lecture qu'il surveille est résolue dans cet ordre : une liaison de donnée portant l'alias de l'ordre **sur l'appareil même auquel l'ordre a été envoyé** ; à défaut, la liaison sur un autre appareil, si son type peut rapporter la valeur ordonnée ; à défaut, la donnée propre de l'appareil ciblé sous la clé de l'ordre, là où un thermostat cloud publie un état que personne n'a lié. Quand aucune des trois n'existe, l'ordre reste suivi et rejoué, mais il sort de la surface d'alarme : une alarme que rien ne peut résoudre est du bruit.

La règle du milieu existe parce qu'un alias n'est pas un vocabulaire. Sur un appareil sous-compté, `power` désigne à la fois le booléen envoyé à l'appareil et la puissance lue par une pince, et comparer les deux ne peut jamais être vrai (issue #901).

#### Les deltas d'énergie sont cumulés, jamais échantillonnés

Un binding `energy` porte un **delta additif** (Wh depuis le tick précédent), pas une mesure. La déduplication qui protège les autres catégories (deadband, intervalle minimum de 30 s) détruirait silencieusement de l'énergie : les compteurs ont des cadences très différentes — un Shelly EM émet un tick par minute, un Tuya PJ-1203A en émet ~30, dont un seul porte le saut de compteur de 10 Wh.

Le `HistoryWriter` cumule donc les ticks `energy` temps réel sur la minute et écrit un point unique aligné sur le début de minute, découpage HP/HC compris. Le `SelfConsumptionWriter` cumule de la même façon la minute appairée Réseau + Solaire et en dérive `autoconso` / `injection` / consommation foyer. Le solaire inclut les deltas `production` que le `PowerSubmeterIntegrator` écrit pour un sous-compteur à puissance seule marqué `localProduction` (spec 195 : un panneau raccordé derrière lui, vu par le compteur réseau mais pas par le compteur de production) ; une minute qui porte un tel delta sans tick réseau le reporte sur la minute écrite suivante au lieu de le perdre.

#### Un seul écrivain par série

Les deux writers ferment leur bucket de minute sur des déclencheurs différents : le `HistoryWriter` par binding, le `SelfConsumptionWriter` au premier tick de la minute suivante venant de l'un ou l'autre compteur. Partager une série entre eux serait donc une course au dernier écrivain, arbitrée par le compteur qui émet le premier. La propriété des séries `energy` / `energy_hp` / `energy_hc` du compteur réseau est de ce fait exclusive :

- **Avec un `energy_production_meter` configuré**, le `SelfConsumptionWriter` en est le seul écrivain (sémantique foyer), et le `HistoryWriter` ignore exactement ces trois alias sur le `main_energy_meter`. Il continue d'écrire tout le reste : puissance, tension, `energy_forward` / `energy_reverse`, tous les sous-compteurs, et l'énergie propre du compteur solaire.
- **Réseau seul (pas de compteur de production)**, le `SelfConsumptionWriter` est inerte et le `HistoryWriter` écrit l'énergie réseau cumulée brute, comme avant.

La propriété suit le cache d'équipements : ajouter ou retirer le compteur de production à chaud transfère la série sans redémarrage.

Deux conséquences à connaître :

- Toute minute ayant vu un tick réseau est écrite. Une minute sans tick solaire n'est pas un trou : c'est un import réseau pur (`autoconso = 0`). Seule une minute solaire-seule est abandonnée — l'injection est indéfinie sans le côté réseau.
- Les ticks porteurs d'un `sourceTimestamp` explicite (plugins publiant des fenêtres historiques alignées, ex. fenêtres 30 min Netatmo/Legrand) sont déjà agrégés : le `HistoryWriter` les écrit tels quels et le découpage HP/HC est classifié sur 30 minutes, et non sur les 60 s d'un bucket temps réel.

---

## Recharges de véhicules électriques (spec 191)

`EvSessionTracker` (`src/energy/ev-sessions/`) fait de chaque branchement sur une `ev_charger` une recharge enregistrée, du moment où le `vehicle` de la borne quitte `disconnected` à celui où il y revient. Sur une **borne mesurée** (spec 193 : une `ev_charger` sans point `vehicle`, liée à un compteur d'énergie), la recharge suit sa `power` : elle s'ouvre au premier relevé de 500 W ou plus, et le tick la ferme après 30 minutes sous 500 W, datée du dernier relevé actif. Les relevés des voitures reçus pendant ces 30 minutes sont mis de côté et comptés à la clôture par rapport à cette fin, ou dans la recharge si elle reprend. Il n'écoute que les `equipment.data.changed` en direct, jamais InfluxDB : une recharge fonctionne sans InfluxDB et survit à la rétention du bucket brut.

- **Comptage par tranches de 5 minutes.** Le tirage de la voiture est la `power` de la borne, maintenue entre deux relevés (au plus 15 minutes après le dernier relevé de la borne), ou ses deltas d'`energy` pour une borne sans puissance. Côté réseau, c'est le **delta signé en direct** du compteur général (la même entrée que `SelfConsumptionWriter`). Un delta mesure le temps écoulé depuis le précédent et arrive environ une minute après : `HouseGridLedger` (`house-grid.ts`) le répartit sur ce temps, par cases d'une minute. Une tranche fermée attend un delta couvrant sa fin (3 minutes au plus) puis est chiffrée : la voiture paie `min(tirage, import pendant sa propre partie de la tranche)`, servie en dernier par le soleil, et les recharges d'une même tranche se partagent son import au prorata de leur tirage (`poolImport`). Une tranche que le compteur n'a pas couverte en entier (un silence au milieu, ou aucun delta après sa fin), ou une maison sans compteur général, compte tout en réseau (jamais de solaire inventé) ; une voiture qui ne peut pas prendre sa part de l'import la laisse aux autres. La part réseau est répartie par le `TariffClassifier` et chiffrée à ce moment-là : le coût est figé. L'énergie de la recharge est celle du compteur de la borne ; les tranches donnent les parts, mises à l'échelle à la lecture. Une recharge dont le compteur a avancé sans aucune tranche mesurée est chiffrée tout réseau sur sa durée.
- **Attribution.** Chaque relevé d'une voiture (`plugged`, `charging_state`, `battery_level`, `at_home`) s'ajoute aux indices de cette voiture, d'après le `reported_at` de la voiture (jamais pour `at_home`, qui vient de son propre relevé de position). Il compte s'il est fait pendant la recharge, et aussi :
  - un `plugged`, un `charging` ou un niveau de batterie fait jusqu'à 15 minutes avant le début (issue #1105 : la voiture date son relevé du vrai début, la recharge peut s'ouvrir plus tard). Cette tolérance est fixée par voiture à l'ouverture et coupée par toute recharge qui tient cette voiture juste avant : la précédente de cette borne toujours, celle d'une autre borne quand cette voiture lui a été attribuée à la main ou y a été vue en charge avant la tolérance. Une voiture vue sur une autre borne pour la première fois dans la tolérance peut être celle qui vient de se brancher ici (une borne mesurée s'ouvre à son premier 500 W, des minutes après le branchement) : son relevé compte alors pour les deux recharges, qui restent à attribuer plutôt que de deviner. Le dernier niveau avant le début est le niveau de départ de la recharge ;
  - un niveau de batterie jusqu'à 15 minutes après la fin relève le plus haut.
    À l'ouverture ou à la reprise d'une recharge, l'état actuel de chaque voiture est lu de la même façon, et une voiture dont la dernière position connue est hors de la maison est marquée : elle doit être vue à la maison pendant la recharge pour correspondre (une voiture qui charge ailleurs ne prend jamais une recharge à la maison).
    Deux heures après la fin, une seule voiture vue en charge ou dont la batterie a monté d'au moins 2 points, et pas vue ailleurs, obtient la recharge (le débranchement signalé par la voiture elle-même ne compte pas contre elle : elle le date avant que la borne ne le signale) ; plusieurs ou aucune la laissent « à attribuer ». Le choix d'une personne (`PUT /api/v1/ev-sessions/:id/attribution`, tout rôle) est définitif ; une recharge attribuée à la main pendant la charge suit quand même la batterie de sa voiture jusqu'au bout.
- **Deux bornes (spec 193).** Une voiture ne charge que sur une borne à la fois : avant de trancher, les voitures qu'une recharge d'une autre borne sur le même créneau revendique (à la main, ou ce que ses propres indices donnent — sa seule candidate ou sa voiture habituelle, tranchée ou pas encore, jamais « seule voiture ») sont retirées des candidates ; deux recharges qui revendiquent la même voiture se l'enlèvent l'une à l'autre, dans n'importe quel ordre. Plusieurs voitures possibles sont ensuite distinguées par la mesure (spec 194) : une voiture dont le `charge_power` reste en désaccord avec les relevés de la borne à moins de 2 minutes du sien (gardés 3 h pour comparer les relevés tardifs ; pas de mesure tant que la borne est sous 500 W, au démarrage, à l'arrêt ou en pause) charge ailleurs et n'est pas candidate ; la seule voiture dont la puissance concorde, toutes les autres ayant des mesures qui ne concordent pas, obtient la recharge (`power-match`) ; deux recharges qui revendiquent la même voiture avec la même force (toutes deux sûres, ou toutes deux des suppositions) restent à attribuer, tandis qu'un choix à la main ou une revendication sûre la prend à une supposition ; sinon la seule voiture dont la hausse de batterie × l'énergie par point apprise colle à l'énergie de la recharge, toutes les autres étant nettement loin (`energy-match` ; l'énergie par point n'est apprise que sur des recharges attribuées à la main, comme seule candidate, par la puissance ou comme seule voiture). Ensuite seulement, la **voiture habituelle** d'une borne (`equipments.usual_vehicle_id`) départage (raison `usual-vehicle`) ; elle ne prend jamais une recharge qu'aucune voiture ne revendique. Une seule candidate qui ne l'est que parce qu'une voiture habituelle a pris l'autre ailleurs s'affiche aussi `usual-vehicle`. `currentForVehicle` (spec 192) applique la même règle.
- **Coût aux 100 km** : prix maison du kWh × consommation mesurée, c'est-à-dire l'énergie au mur par point de batterie, apprise sur les recharges à la maison, multipliée par la batterie utilisée par km sur les trajets pendant lesquels la voiture n'a pas rechargé. Recharger ailleurs ne le fausse donc jamais.

Chaque changement est enregistré en entier ; un tick de 30 s ferme les tranches échues, chiffre celles dont les relevés réseau sont arrivés et tranche les recharges dont le délai de grâce est passé. Un arrêt chiffre les tranches encore en attente (tout réseau là où le compteur ne les a pas encore couvertes) et perd la tranche en cours des recharges ouvertes ; un plantage perd aussi celles en attente (au plus les dernières minutes). Une recharge reprise reprend la dernière puissance de sa borne, dans sa limite de maintien. Une recharge terminée reste suivie jusqu'à la fin de son délai de grâce, même attribuée à la main (son niveau de batterie final). Conception complète : `specs/191-ev-charge-sessions/`, complétée par les specs 192 et 193 et les issues #1105 et #1107.

## Authentification et autorisation

- **Mots de passe** : bcrypt (cost 12).
- **JWT** : HS256 via `jsonwebtoken`. TTL access token : 15 min. TTL refresh token : 30 jours.
- **Tokens d'API** : préfixe `swl_`, hash SHA-256 stocké, généré via `crypto.randomBytes(32)`. Préfixes legacy `wch_` et `cbl_` aussi acceptés.
- **Middleware d'auth** : tente d'abord le décodage JWT, puis le lookup de token d'API.
- **Rôles** : `admin` > `standard` > `viewer` (permissions hiérarchiques).
- **Setup au premier démarrage** : `POST /api/v1/auth/setup` crée le premier utilisateur admin.

---

## Accès partagés (spec 181)

`src/shared-access/` permet à quelqu'un qui n'est pas utilisateur de Sowel d'ouvrir un équipement
`gate` pour un temps, avec un code ou un lien. La fonctionnalité est à activer
(`sharedAccess.enabled`, désactivée par défaut) ; tant qu'elle est désactivée, chaque surface répond
comme une route inconnue.

- **Un gestionnaire, trois appelants.** `SharedAccessManager` porte toutes les règles pour les routes
  admin du propriétaire (`/api/v1/shared-access/*`), les routes anonymes qu'appelle la page du
  visiteur (`/api/v1/shared-access/public/*`, servies aussi en `/access/api/*`) et le
  `deps.sharedAccess` propre à chaque plugin (spec 181 R9). Aucun ne touche directement
  `SharedAccessStore` (SQLite, migrations `035` et `036`).
- **Décider, puis appuyer.** Un appui est d'abord décidé (révoqué, suspendu, validité, portail listé
  et armé, plafonds), puis mis en file par portail (`gate-queue.ts` : double appui, délai de 15 s sur
  l'ordre, 5 en attente au plus) et envoyé par `EquipmentManager.executeOrder` avec l'`OrderSource`
  `{ kind: "shared_access" }` : inversion, résolution de valeur, confirmation de livraison et
  attribution dans l'Activité viennent avec.
- **La surface publique.** `guest-page.ts` sert la page du visiteur depuis des chaînes, en
  `/access/` : pas la SPA, CSP stricte, `no-store`, aucun cookie. Seuls les échecs comptent dans un
  budget anti-devinette global (`guessing.ts`) ; le débit d'essais par visiteur est l'affaire du
  reverse proxy.
- **Secrets.** Les codes sont gardés en clair à dessein (ils se dictent au téléphone). Les jetons de
  lien dérivent du secret de la maison `sharedAccess.linkSecret`, que l'API des réglages ne renvoie
  jamais ; les jetons de téléphone sont aléatoires. Seuls les hachés des jetons de lien et de
  téléphone sont stockés.

Détails : [spec 181](https://github.com/mchacher/sowel/tree/main/specs/181-shared-access),
[guide utilisateur](../user/shared-access.md), [API](api-reference.md#shared-access-spec-181).

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

| Propriété                 | Valeur                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Police body**           | Inter                                                                                                                                    |
| **Police mono**           | JetBrains Mono pour les logs, le JSON, les identifiants, les versions et le code seulement ; les nombres sont en Inter `tabular-nums`    |
| **Couleur primaire**      | `#1A4F6E` (ocean blue), hover : `#144159`, light : `#EEF5F8` ; `bg-primary-fill` porte le texte, `bg-primary` (l'encre) jamais           |
| **Rôles de couleur**      | Ambre `#F2C035` = allumé ou en marche seulement ; les autres : `design-system/tokens.md` §1.2                                            |
| **Espacement de base**    | 4px                                                                                                                                      |
| **Border radius**         | 6px contrôles (`rounded-sm`), 10px cartes (`rounded-md`), 16px modales et feuilles (`rounded-lg`), full                                  |
| **Cartes**                | classe `card` : pas de bordure, ombre douce en clair, ton plus clair en sombre ; un groupe dans une carte est un puits (`bg-background`) |
| **Échelle typographique** | `text-micro` 11, `caption` 12, `small` 13, `body` 14, `lead` 16, `title` 20, `display` 28, `value` 40 px ; le lint refuse les autres     |
| **Contrôles**             | Champs et boutons secondaires gardent `border border-border` et un anneau de focus ; `shadow-lg` est pour modales, feuilles, popovers    |
| **Icônes**                | Lucide React, stroke 1.5px                                                                                                               |

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

| Entrée                    | Contenu                                                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sowel-backup.json`       | Export SQLite en JSON, structuré par table (format version 2)                                                                                                                                                             |
| `influx-raw.lp`           | Données InfluxDB brutes en line protocol (7 derniers jours)                                                                                                                                                               |
| `influx-hourly.lp`        | Données horaires downsamplées (90 derniers jours)                                                                                                                                                                         |
| `influx-daily.lp`         | Données journalières downsamplées (5 dernières années)                                                                                                                                                                    |
| `influx-energy-hourly.lp` | Sommes énergétiques horaires (2 dernières années)                                                                                                                                                                         |
| `influx-energy-daily.lp`  | Sommes énergétiques journalières (10 dernières années)                                                                                                                                                                    |
| `influx-rain-hourly.lp`   | Pluie horaire (dernière année)                                                                                                                                                                                            |
| `data/*`                  | Tous les fichiers non DB de `data/` (secrets de tokens, etc.), scannés dynamiquement au regard de la liste blanche de restauration, hors `.db`, `.pid`, `.log` et hors marqueurs locaux `.instance-id` / `.shadow-target` |

L'export JSON SQLite couvre une liste sélectionnée de tables (constante `BACKUP_TABLES` dans `backup-manager.ts`) dans l'ordre des dépendances (parents d'abord pour la restauration).

Le marqueur `.instance-id` est exclu volontairement, dans les deux sens : il décrit le déploiement en cours d'exécution, et une archive qui l'embarquerait donnerait à l'instance qui restaure l'identité de la machine d'où viennent les données, désarmant le garde-fou de restauration de l'issue #401. Voir la section « Restaurer un backup d'un autre déploiement » de [deployment.fr.md](deployment.fr.md).

À la restauration, les entrées `data/` passent par une liste blanche d'extensions (spec 089 C2) : tout ce qui n'est pas une extension de données ou d'image connue est refusé, pour qu'une archive ne puisse pas glisser un script ou un module natif dans le répertoire de données. Un nom de fichier commençant par un point compte comme sa propre extension, c'est ainsi que `.jwt-secret` et `.influx-token` figurent dans cette liste et que tout autre fichier caché est refusé. Un nom sans aucune extension est refusé également (issue #829).

Le scan d'export applique la même liste blanche, si bien qu'une archive ne peut jamais contenir une entrée que sa propre restauration écarterait. C'est cette propriété que suppose la note de risque de la spec 089 ; sans elle, un fichier pouvait être archivé puis disparaître silencieusement à la restauration. Ce qui est laissé de côté est nommé dans le log d'export, et une restauration renvoie `filesSkipped` à côté de `filesRestored`, pour qu'une restauration partielle soit visible plutôt que muette.

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

1. **job verify-release-notes** : fait échouer le workflow avant tout build si le commit taggé n'a pas d'ancre de release notes (spec 108)
2. **job ci** : typecheck, lint, tests (backend + UI)
3. **jobs docker** : build `linux/amd64` et `linux/arm64` avec Buildx en parallèle, chacun poussant son propre tag (`:<version>`, et `:<version>-arm64` plus `:latest-arm64` pour le job arm64)
4. **job promote-manifest** : fusionne les deux en un `:<version>` multi-architecture, puis fait pointer `:latest` dessus
5. **job release** : crée la GitHub Release avec des notes auto-générées
6. **job arm64-required** : fait échouer le run quand la release a été retenue, pour qu'un échec arm64 ne soit pas juste un job grisé sur un run vert
7. **job prune-ghcr** : conserve les 30 versions GHCR les plus récentes après une release réussie, sans jamais toucher aux tags flottants `:latest`

Le build Docker est **multi-architecture** : amd64 et arm64 sont construits dans des jobs parallèles puis fusionnés en un seul manifeste, de sorte que `docker pull` résout la bonne image.

L'ordre des trois dernières étapes est une exigence de correction, pas de confort. `UpdateChecker` interroge la GitHub Release et non le manifeste GHCR : une Release publiée alors que `:<version>` est encore amd64-only annoncerait une mise à jour à tous les Raspberry Pi puis ferait échouer leur `docker pull`. `promote-manifest` et `release` sont donc conditionnés à la réussite du build arm64, et `:latest` n'est publié que par `promote-manifest`, jamais par le job amd64. Un échec arm64 laisse `:<version>` poussé en amd64-only et retient à la fois `:latest` et la Release : rien n'annonce une version que la moitié du parc ne peut pas récupérer. La récupération passe par **Re-run all jobs** sur ce run, jamais par un dispatch du workflow sur le tag : le chemin dispatch résout la version depuis `test_tag`, donc il construit des images de test et ne publie rien sous la version du tag.

### Script de release

`scripts/release.sh <version>` :

1. Valide le format semver et un working tree propre
2. **Vérifie** que `package.json` et `ui/package.json` sont déjà à cette version, et sort sinon. Il ne les bump pas : c'est une PR normale qui le fait, et elle est mergée avant le tag
3. Tag `vX.Y.Z` et pousse le tag vers origin
4. GitHub Actions prend le relais

Il ne lance aucune validation de son côté et ne commite pas. La protection de branche impose que le bump de version et les release notes passent d'abord par une PR.

Une skill Claude Code emballe ça dans `.claude/skills/sowel-release/SKILL.md`.

### Image Docker (`Dockerfile`)

Build multi-étages :

1. **backend-build** : Node 24, `tsc` backend
2. **ui-build** : Node 24, build Vite UI
3. **runtime** : Debian Trixie (pour Python 3.13), Node 24 installé via NodeSource, Python 3.13 + venv pour les plugins qui en ont besoin (par ex. Panasonic CC), `better-sqlite3` recompilé pour la plateforme

L'image runtime fait environ 950 Mo non compressée (environ 210 Mo de contenu). L'exigence Python 3.13 vient du plugin Panasonic CC qui a besoin d'une syntaxe f-string indisponible en Python 3.11.

---

## Activity Buffer (spec 101)

`src/activity/activity-buffer.ts` garde les **7 derniers jours** d'événements moteur (filtrés et enrichis pour la vue zone, plafonnés à 2000 items en mémoire), persistés dans la table `activity_log` et rechargés au démarrage. Il alimente le panneau **Activité** dans la vue zone ([guide utilisateur](../user/zones.md#fil-dactivite)).

### Flux d'événements

1. Le buffer souscrit à un sous-ensemble curé d'`EngineEvent`s : `equipment.order.executed`, `equipment.data.changed` (filtré sur la catégorie de binding `motion`, `water_leak`, `smoke`), `recipe.instance.started/stopped/error`, `mode.activated/deactivated`, `sunlight.changed`, `system.alarm.raised`, `system.alarm.resolved`. Une résolution est classée dans la zone portée par son événement, à défaut dans celle de la levée vue par le buffer (globale s'il n'a ni l'une ni l'autre, par exemple une alarme levée avant un redémarrage).
2. Pour chaque événement, il résout le nom d'équipement / de recette et le `zoneId` pertinent via les managers (equipment, recipe, zone, sunlight), puis construit un `ActivityItem`.
3. Il pousse l'item dans le ring buffer (cap par count, purge des entrées dépassant le TTL) et émet un événement `activity.added` sur le bus.
4. La couche WebSocket diffuse cet événement aux clients abonnés au topic `activity`. Les clients bootstrapent également via `GET /api/v1/activity` au montage.

### Attribution des sources

`executeOrder()` accepte un 4e argument optionnel `source` de type `OrderSource`. Le SDK des recettes expose un closure `ctx.dispatchOrder()` par instance qui pré-lie le `source` de la recette, ce qui évite aux helpers internes d'avoir à threader `source` eux-mêmes. Les modes, les bindings de boutons et les routes API passent le source inline. Les plugins de recettes externes continuent de fonctionner sans attribution (dégradation gracieuse).

### Empreinte mémoire

À environ 400 octets par item, 2000 items représentent environ 800 Ko, soit moins de 0,3 % du RSS d'un conteneur Sowel typique. Contrairement au ring buffer des logs, le fil **survit au redémarrage** : il est adossé à SQLite (spec 147).

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

## Gestion des fuseaux horaires (spec 061) { #timezone-handling }

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
