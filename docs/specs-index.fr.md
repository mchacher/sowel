# Index des specs Sowel

Ce fichier sert d'aide à la navigation sur `specs/`. Chaque spec sous `specs/XXX-name/` contient typiquement trois fichiers : `spec.md` (exigences + critères d'acceptation), `architecture.md` (design technique), `plan.md` (étapes d'implémentation).

**Utilisez cet index pour récupérer rapidement le contexte** : parcourez les descriptions, trouvez la spec pertinente, puis lisez le dossier complet pour les détails.

Les specs sont regroupées par thème et annotées d'un statut :

- ✅ **active** : implémentée et en production
- 🔁 **superseded** : remplacée par une spec ultérieure (suivez la flèche)
- 🟡 **partial** : implémentée, mais le périmètre a évolué

---

## Fondations (V0.x) : moteur central

| #   | Title                                  | Status                    | Résumé                                                                                         |
| --- | -------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------- |
| 001 | V0.1 MQTT devices                      | ✅                        | Première intégration avec le bridge Zigbee2MQTT. Auto-découverte de devices brute via MQTT.    |
| 002 | V0.1 UI scaffolding devices            | ✅                        | Frontend React initial avec liste de devices.                                                  |
| 003 | V0.2 Zones                             | ✅                        | Zones imbriquables hiérarchiquement. Structure parent-enfant en arbre.                         |
| 004 | V0.3 Equipments                        | ✅                        | Équipements user-facing qui se lient aux devices via des clés de données.                      |
| 005 | V0.5 UI restructuring                  | ✅                        | Refonte de la navigation (home, zones, équipements, devices, admin).                           |
| 006 | V0.6 Sensor equipments                 | ✅                        | Types de capteurs température, humidité, mouvement, luminance.                                 |
| 007 | V0.7 Zone aggregation                  | ✅                        | Calcul auto des métriques de zone depuis les données d'équipement (motion=OR, temp=AVG, etc.). |
| 008 | Shutter equipments                     | ✅                        | Position + état + ordres de cover (ouvrir/fermer/stop).                                        |
| 009 | V0.8 Recipes                           | ✅                        | Moteur d'automatisation avec slots typés. Premières recettes intégrées.                        |
| 010 | V0.9 Modes                             | ✅                        | États nommés au niveau zone (Day/Night/Away) avec impacts.                                     |
| 011 | V0.10a Integration plugin architecture | 🔁 superseded by 040, 053 | Interface plugin initiale pour les intégrations.                                               |

## V0.10 : intégrations natives (la plupart sont maintenant 🔁 externalisées en plugins)

| #   | Title                          | Status                | Résumé                                                                               |
| --- | ------------------------------ | --------------------- | ------------------------------------------------------------------------------------ |
| 012 | V0.10b Panasonic Comfort Cloud | 🔁 → 050              | Polling de l'API cloud des climatiseurs Panasonic (maintenant un plugin).            |
| 013 | V0.10c MCZ Maestro             | 🔁 → 049              | Intégration Socket.IO du poêle à granulés MCZ (maintenant un plugin).                |
| 014 | V0.10d Netatmo Home+Control    | 🔁 → 048a, 048b, 048c | Intégration Netatmo HC (séparée maintenant en 3 plugins : weather, control, energy). |

## V0.11 : logging, backup, UX volets

| #   | Title                           | Status             | Résumé                                                                          |
| --- | ------------------------------- | ------------------ | ------------------------------------------------------------------------------- |
| 015 | V0.11 Logging system            | ✅                 | Logging structuré pino, ring buffer, tagging par module, viewer de logs UI.     |
| 016 | V0.8b Motion Light enhancements | ✅                 | Affinements de la recette motion-light (créneaux horaires, override, fallback). |
| 017 | V0.11b Backup hardening         | 🔁 → 046, 058, 060 | Premier système de backup (export/import).                                      |
| 018 | Recipes roadmap                 | ✅ (meta)          | Document roadmap pour les recettes prévues.                                     |
| 019 | V0.8c Switch light              | ✅                 | Recette switch-light (bascule à l'appui sur bouton).                            |
| 020 | V0.8e Presence thermostat       | ✅                 | Logique de consigne thermostat basée sur la présence avec cocoon.               |
| 021 | V0.8f Zone commands             | ✅                 | Batching d'ordres au niveau zone (allShuttersOpen/Close, allLightsOn/Off).      |

## UX et tableau de bord

| #   | Title                              | Status   | Résumé                                                                                                                                                                                            |
| --- | ---------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 022 | Dark mode                          | ✅       | Dark mode basé sur la classe Tailwind avec préférence utilisateur.                                                                                                                                |
| 023 | Sunrise / sunset                   | ✅       | Sunlight manager basé sur SunCalc avec réglages d'offset.                                                                                                                                         |
| 024 | Motion light split                 | ✅       | Séparation de motion-light en variantes basique et dimmable.                                                                                                                                      |
| 025 | V0.13 History (InfluxDB)           | ✅       | Historique en série temporelle pour les données numériques de devices.                                                                                                                            |
| 026 | V0.8 Cocoon thermostat             | ✅       | Logique cocoon au coucher pour le thermostat de présence.                                                                                                                                         |
| 027 | V0.8 Presence heater               | ✅       | Recette de radiateur basée sur la présence (éco/confort).                                                                                                                                         |
| 028 | MQTT publishers                    | ✅       | Manager de publisher MQTT sortant (mappings d'événements vers topics). v1.2.6 : option `onChangeOnly`, publication seulement au changement de valeur pour ne pas inonder les afficheurs externes. |
| 029 | MQTT brokers                       | ✅       | Support multi-broker pour les publishers MQTT.                                                                                                                                                    |
| 030 | Logging audit                      | ✅       | Stratégie consolidée des niveaux de log et taxonomie des modules.                                                                                                                                 |
| 031 | Notification publishers            | ✅       | Canaux de notification Telegram / webhook / FCM / ntfy.                                                                                                                                           |
| 032 | State watch recipe                 | ✅       | Surveillance générique de clé de donnée avec recette d'alarme.                                                                                                                                    |
| 033 | Dashboard widgets                  | ✅       | Widgets de zone personnalisables sur le tableau de bord.                                                                                                                                          |
| 034 | Progressive Web App                | ✅       | Manifest PWA, service worker (`NetworkOnly` pour /api/), bandeau offline.                                                                                                                         |
| 035 | Energy dashboard                   | ✅       | Ventilation jour/semaine/mois/année avec classification HP/HC.                                                                                                                                    |
| 036 | Order dispatch error handling      | ✅       | Fallback gracieux quand la publication d'un ordre échoue.                                                                                                                                         |
| 037 | Panasonic CC connection resilience | 🔁 → 050 | Logique de reconnexion pour Panasonic Comfort Cloud.                                                                                                                                              |
| 038 | MCZ connection resilience          | 🔁 → 049 | Logique de reconnexion pour MCZ Maestro.                                                                                                                                                          |
| 039 | Integrations page redesign         | ✅       | Page intégrations unifiée (liste, configuration, statut).                                                                                                                                         |

## Système de plugins V2 (crucial, architecture actuelle)

| #   | Title                      | Status               | Résumé                                                                 |
| --- | -------------------------- | -------------------- | ---------------------------------------------------------------------- |
| 040 | Plugin engine              | 🟡 superseded by 053 | Première génération de moteur de plugins (install depuis zip local).   |
| 041 | Weather forecast plugin    | ✅                   | Plugin de prévisions météo basé sur Open-Meteo (exemple de référence). |
| 042 | Weather forecast equipment | ✅                   | Type d'équipement pour l'affichage des données de prévision.           |
| 043 | Plugin update              | ✅                   | Mise à jour de plugin in-place depuis une release GitHub.              |
| 044 | Plugin SmartThings         | ✅                   | Plugin Samsung SmartThings (polling + ordres).                         |
| 045 | Plugin SmartThings OAuth   | ✅                   | Flux OAuth2 pour l'authentification SmartThings.                       |
| 046 | Backup v2                  | 🔁 → 058, 060        | Format de backup révisé (inclut le line protocol InfluxDB).            |
| 047 | Prebuilt plugins           | ✅                   | Distribution de plugins via les releases GitHub (tarball).             |

## V1.0 : externalisation de toutes les intégrations en plugins

| #    | Title                       | Status | Résumé                                                                                                                                                         |
| ---- | --------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 048a | Plugin Netatmo Weather      | ✅     | Intégration Netatmo Weather Station externalisée.                                                                                                              |
| 048b | Plugin Legrand Control      | ✅     | Legrand Home+Control externalisé (lumières/volets/prises).                                                                                                     |
| 048c | Plugin Legrand Energy       | ✅     | Suivi énergétique Legrand externalisé (compteurs NLPC).                                                                                                        |
| 049  | Plugin MCZ Maestro          | ✅     | Intégration MCZ Maestro externalisée.                                                                                                                          |
| 050  | Plugin Panasonic CC         | ✅     | Intégration Panasonic Comfort Cloud externalisée.                                                                                                              |
| 051  | Plugin LoRa2MQTT            | ✅     | Bridge LoRa2MQTT en tant que plugin.                                                                                                                           |
| 052  | Plugin Zigbee2MQTT          | ✅     | Zigbee2MQTT en tant que plugin (la dernière intégration native à être externalisée).                                                                           |
| 053  | **Package manager**         | ✅     | **Refactor majeur** : le service `PackageManager` gère tous les paquets (intégrations + recettes). Distribution basée sur GitHub avec `plugins/registry.json`. |
| 054  | Recipe packages             | ✅     | Recettes externalisées en tant que paquets (même modèle de distribution que les plugins).                                                                      |
| 055  | Versioning + CI/CD + Docker | ✅     | Workflow de release GitHub Actions, `scripts/release.sh`, image ghcr.io, tags semver. Introduit en v1.0.0.                                                     |

## V1.0+ : auto-update et déploiement

| #   | Title                                           | Status   | Résumé                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 057 | Self-update UI                                  | 🔁 → 060 | Premier auto-update via l'UI (avait une race condition).                                                                                                                                                                                                                                                                                                                |
| 058 | Backup completeness                             | ✅       | Auto-téléchargement des plugins manquants au démarrage ; scan dynamique des fichiers de données ; restauration FK-safe.                                                                                                                                                                                                                                                 |
| 059 | Remote registry + backup fix                    | ✅       | Récupération de `plugins/registry.json` à distance avec cache + fallback local. InfluxDB ensureBuckets avant restauration.                                                                                                                                                                                                                                              |
| 060 | **Self-update helper + detection improvements** | ✅       | **Architecture actuelle d'auto-update** : pattern de container helper (spawn `docker:25-cli` qui survit à la mort de sowel), backup pré-update auto dans `data/backups/` (rotation, conserve 3), poll de version 1 h, push WebSocket de update.available, bouton "Check for updates", détection `composeManaged`.                                                       |
| 061 | **Timezone from home location**                 | ✅       | Auto-dérivation de `process.env.TZ` depuis `home.latitude`/`home.longitude` via `tz-lookup` au boot (s'exécute avant `createLogger()` pour éviter le caching TZ V8). Endpoints `GET /system/timezone` + `POST /system/restart` (container helper). UI : TZ dans Réglages, `CurrentTimePill` dans le header, `RestartToast` au changement de localisation.               |
| 062 | Water valve equipment                           | ✅       | Nouveau type d'équipement `water_valve` avec icône custom de vanne, famille de widget `water`, agrégation de zone (open/total + somme de débit), pastille de zone, widget tableau de bord (close-all), et carte de détail avec toggle + arrosage minuté. Cible les SONOFF SWV et vannes connectées similaires. Base pour une future recette d'auto-arrosage (spec 063). |

## Refactoring du dispatch d'ordre (migration progressive)

| #   | Title                             | Status  | Résumé                                                                                                                                                           |
| --- | --------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 067 | Order dispatch — core + lora2mqtt | ✅      | Nouvelle signature `executeOrder(device, orderKey, value)` avec rétro-compat v1. Première migration : lora2mqtt v2.0.0. Résolution d'enum insensible à la casse. |
| 068 | Order dispatch — zigbee2mqtt      | ✅      | Migration du plugin z2m vers v2.0.0 (apiVersion 2). Support des payloads composites préservé.                                                                    |
| 069 | Order dispatch — legrand-control  | Planned | Migration de legrand-control (IDs API cloud stockés en mémoire du plugin).                                                                                       |
| 070 | Order dispatch — panasonic-cc     | Planned | Migration de panasonic-cc (guid/param stockés en mémoire du plugin).                                                                                             |
| 071 | Order dispatch — mcz-maestro      | Planned | Migration de mcz-maestro (commandId stocké en mémoire du plugin).                                                                                                |
| 072 | Order dispatch — netatmo-security | Planned | Migration de netatmo-security (paramètre unique : monitoring).                                                                                                   |
| 073 | Order dispatch — smartthings      | Planned | Migration de smartthings (noms de commande stockés en mémoire du plugin).                                                                                        |
| 074 | Order dispatch — cleanup          | Planned | Suppression de la rétro-compat v1. Suppression de la colonne `dispatch_config` de `device_orders`.                                                               |

---

## Équipements piscine

| #   | Title                       | Status | Résumé                                                                                            |
| --- | --------------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| 081 | Pool equipments             | ✅     | Types `pool_pump`, `pool_cover` avec liaison basée sur des candidats pour les relais multi-canaux |
| 082 | Pool pump schedule          | ✅     | Plugin de recette avec 3 créneaux on/off journaliers                                              |
| 083 | Pool heat pump (Polytropic) | ✅     | Type `pool_heat_pump` + plugin d'intégration Modbus (Polytropic Master Inverter)                  |

## Refactor énergétique Shelly (multi-itérations)

| #   | Title                                 | Status   | Résumé                                                                                                                              |
| --- | ------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 084 | Shelly energy — overview              | Planned  | Principes directeurs pour la migration en 4 itérations de Legrand vers Shelly Pro 3EM                                               |
| 085 | Iteration 1 — shelly-em plugin (live) | Planned  | Plugin Sowel : `act_power` live et compteurs par canal, en parallèle de Legrand                                                     |
| 086 | Iteration 2 — Shelly drives roles     | Planned  | Promotion des canaux Shelly en `main_energy_meter` + `energy_production_meter`, retrait de Legrand                                  |
| 087 | Iteration 3 — energydata-stack        | Rejected | Remplacé par l'archive native du Shelly Pro 3EM (60 j in-device) ; voir 088 pour le correctif réel                                  |
| 088 | Iteration 4 — Shelly gap backfill     | Planned  | Le plugin interroge la RPC `EM1Data.GetData` au boot et toutes les heures pour rejouer les minutes manquantes dans le pipeline live |

## V1.5 : graphique par usage, bascules MQTT, recette state-trigger

| #   | Title                        | Status | Résumé                                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 090 | MQTT mapping enable/disable  | ✅     | Flag `enabled` par mapping sur les publishers MQTT, en complément de la bascule au niveau publisher. Icône power-off UI + opacité réduite sur les lignes désactivées. Permet à l'utilisateur de mettre en sourdine un seul mapping (source saisonnière) sans perdre sa configuration.                                                      |
| 091 | By-usage consumption chart   | ✅     | Nouvel endpoint `GET /energy/by-usage` et bascule Total / Par usage sur la page Énergie qui rend une ventilation empilée par sous-compteur `energy_meter` + un résidu "Other" (`compteur principal - Σ sous-compteurs`).                                                                                                                   |
| 092 | State-triggered light recipe | ✅     | Nouveau plugin de recette externe `state-trigger-light` (dans `plugins/registry.json`). Allume les lumières pour une durée fixe quand l'alias `state` d'un équipement surveillé transite vers une valeur cible. Filtre nightOnly optionnel via le sunlight manager. Introduit les contraintes de slot `crossZone` et `includeDescendants`. |

## V1.11 : durcissement runtime des plugins

| #   | Titre                      | Statut | Résumé                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 111 | Isolation soft des plugins | ✅     | Proxies scopés autour des `PluginDeps` de chaque plugin (settings, event bus, device manager). Quatre invariants enforces au niveau JavaScript : settings scopés à `integration.<own-id>.*`, whitelist d'events `system.*`, ownership des devices forcée par `integrationId`, et confinement des erreurs sur les méthodes lifecycle. Actif sans condition depuis v1.11.0. Pas de breaking change pour les auteurs de plugins. |
| 112 | Handlers de crash process  | ✅     | Listeners globaux `uncaughtException` et `unhandledRejection` installés au boot. Un throw qui échappe à toutes les autres protections produit désormais une ligne `fatal` structurée (stdout + `data/logs/sowel.N.log`) avant que le process exit, pour que Docker relance le conteneur avec une trace exploitable au lieu d'une boucle silencieuse. Audit F03, spec 112. Livré en v1.11.1.                                   |
| 113 | Journal d'audit            | ✅     | Trail SQLite persistant de toute action sensible (auth, user CRUD, settings, mode, backup, plugin). Nouvelle table `audit_log` + service `AuditLogger` appelé depuis les route handlers avec contexte acteur et IP. Endpoint admin-only `GET /api/v1/audit` avec pagination et filtrage. Rétention 365 jours purgée au boot. Les valeurs sensibles sont redactées du meta. Audit F13, spec 113. Livré en v1.11.1.             |

## V1.13 : store banne + bridge Somfy RTS

| #   | Titre                          | Statut | Résumé                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 115 | Store banne + bridge Somfy RTS | ✅     | Nouveau type d'équipement `awning` (frère du `shutter`) avec sa famille de widget `awnings` et une illustration V3 colorée dédiée (fenêtre + cassette + 10 bandes trapézoïdales festonnées en mode déployé, frise rétractée en mode fermé). Réutilise les catégories `shutter_position` / `shutter_move` / `set_shutter_position` — toute intégration qui les émet peut piloter un store banne. Trois commandes de zone `allAwningsExtend/Stop/Retract`. Plugin compagnon [`sowel-plugin-somfy-rts`](https://github.com/mchacher/sowel-plugin-somfy-rts) pour le bridge ESP32+CC1101 [`somfyrts2mqtt`](https://github.com/mchacher/somfyrts2mqtt). Livré en v1.13.0. |

---

## Comment utiliser cet index après une perte de contexte

1. **Trouvez le thème** dont vous avez besoin via les en-têtes de section ci-dessus
2. **Ouvrez `specs/XXX-name/spec.md`** pour les exigences et critères d'acceptation
3. **Ouvrez `specs/XXX-name/architecture.md`** pour le design technique, les changements de modèle de données, l'impact au niveau fichier
4. **Ouvrez `specs/XXX-name/plan.md`** pour les étapes d'implémentation

Pour l'architecture actuelle basée sur les plugins, commencez par la **spec 053** (PackageManager), c'est la racine de tout ce qui touche aux plugins.

Pour l'auto-update, commencez par la **spec 060**, elle remplace la spec 057 et est le design actuel.

Pour la vue d'ensemble du système, voir [technical/architecture.md](technical/architecture.md).

Pour l'exploitation production (déploiement, backup, auto-update, logs), voir [technical/deployment.md](technical/deployment.md).
