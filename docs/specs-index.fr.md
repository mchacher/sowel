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

| #   | Title                                           | Status   | Résumé                                                                                                                                                                                                                |
| --- | ----------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 049 | Externalize MCZ Maestro as Plugin               | ✅       | Livrée. Voir `specs/049-plugin-mcz-maestro/`.                                                                                                                                                                         |
| 050 | Externalize Panasonic CC as Plugin              | ✅       | Livrée. Voir `specs/050-plugin-panasonic-cc/`.                                                                                                                                                                        |
| 051 | Externalize LoRa2MQTT as Plugin                 | ✅       | Livrée. Voir `specs/051-plugin-lora2mqtt/`.                                                                                                                                                                           |
| 052 | Externalize Zigbee2MQTT as Plugin               | ✅       | Livrée. Voir `specs/052-plugin-zigbee2mqtt/`.                                                                                                                                                                         |
| 053 | PackageManager Extraction + Plugin Adaptation   | ✅       | Livrée. Voir `specs/053-package-manager/`.                                                                                                                                                                            |
| 054 | Recipe Packages                                 | ✅       | Livrée. Voir `specs/054-recipe-packages/`.                                                                                                                                                                            |
| 055 | Versioning 1.0.0, CI/CD & Docker                | ✅       | Livrée en v1.0.0. Voir `specs/055-versioning-cicd-docker/`.                                                                                                                                                           |
| 057 | Self-update UI                                  | 🔁 → 060 | Premier auto-update via l'UI (avait une race condition).                                                                                                                                                              |
| 058 | Backup completeness                             | ✅       | Auto-téléchargement des plugins manquants au démarrage ; scan dynamique des fichiers de données ; restauration FK-safe.                                                                                               |
| 059 | Remote registry + backup fix                    | ✅       | Récupération de `plugins/registry.json` à distance avec cache + fallback local. InfluxDB ensureBuckets avant restauration.                                                                                            |
| 060 | **Self-update helper + detection improvements** | ✅       | Architecture actuelle d'auto-update : container helper `docker:25-cli`, backup pré-update auto dans `data/backups/`, poll de version avec push WebSocket, bouton "Check for updates", détection `composeManaged`.     |
| 061 | **Timezone from home location**                 | ✅       | Dérive `process.env.TZ` de `home.latitude`/`home.longitude` via `tz-lookup` au boot, ajoute `GET /system/timezone` + `POST /system/restart`, et affiche le TZ dans Réglages avec `CurrentTimePill` et `RestartToast`. |
| 062 | Water valve equipment                           | ✅       | Nouveau type d'équipement `water_valve` avec famille de widget `water`, agrégation de zone, widget close-all et arrosage minuté, base de la recette d'auto-arrosage (spec 063).                                       |

## Refactoring du dispatch d'ordre (migration progressive)

| #   | Title                                              | Status  | Résumé                                                                                                                                                           |
| --- | -------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 063 | Auto-watering recipe plugin                        | ✅      | Livrée en v1.1.0. Voir `specs/063-auto-watering-recipe/`.                                                                                                        |
| 064 | Weather computed rain data + cumulative bar charts | ✅      | Livrée en v1.1.0. Voir `specs/064-weather-computed-rain/`.                                                                                                       |
| 065 | Freecooling recipe plugin                          | ✅      | Livrée en v1.1.2. Voir `specs/065-freecooling-recipe/`.                                                                                                          |
| 066 | Registry independence from Sowel releases          | ✅      | Livrée en v1.2.0. Voir `specs/066-registry-independence/`.                                                                                                       |
| 067 | Order dispatch — core + lora2mqtt                  | ✅      | Nouvelle signature `executeOrder(device, orderKey, value)` avec rétro-compat v1. Première migration : lora2mqtt v2.0.0. Résolution d'enum insensible à la casse. |
| 068 | Order dispatch — zigbee2mqtt                       | ✅      | Migration du plugin z2m vers v2.0.0 (apiVersion 2). Support des payloads composites préservé.                                                                    |
| 069 | Order dispatch — legrand-control                   | Planned | Migration de legrand-control (IDs API cloud stockés en mémoire du plugin).                                                                                       |
| 070 | Order dispatch — panasonic-cc                      | Planned | Migration de panasonic-cc (guid/param stockés en mémoire du plugin).                                                                                             |
| 071 | Order dispatch — mcz-maestro                       | Planned | Migration de mcz-maestro (commandId stocké en mémoire du plugin).                                                                                                |
| 072 | Order dispatch — netatmo-security                  | Planned | Migration de netatmo-security (paramètre unique : monitoring).                                                                                                   |
| 073 | Order dispatch — smartthings                       | Planned | Migration de smartthings (noms de commande stockés en mémoire du plugin).                                                                                        |
| 074 | Order dispatch — cleanup                           | Planned | Suppression de la rétro-compat v1. Suppression de la colonne `dispatch_config` de `device_orders`.                                                               |

---

## Équipements piscine

| #   | Title                                               | Status | Résumé                                                                                            |
| --- | --------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| 075 | Order Dispatch: Legrand Energy Migration            | ✅     | Livrée. Voir `specs/075-order-dispatch-legrand-energy/`.                                          |
| 076 | Order Dispatch: Netatmo Weather Migration           | ✅     | Livrée en v1.2.12. Voir `specs/076-order-dispatch-netatmo-weather/`.                              |
| 077 | Order Categories                                    | ✅     | Livrée en v1.2.12. Voir `specs/077-order-category/`.                                              |
| 078 | Button Zone Orders & Zone-First Equipment Selection | ✅     | Livrée en v1.2.14. Voir `specs/078-button-zone-orders/`.                                          |
| 079 | Device Data Enum Values                             | ✅     | Livrée en v1.2.14. Voir `specs/079-data-enum-values/`.                                            |
| 080 | Tasmota Plugin Integration                          | ✅     | Livrée en v1.2.15. Voir `specs/080-tasmota-plugin/`.                                              |
| 081 | Pool equipments                                     | ✅     | Types `pool_pump`, `pool_cover` avec liaison basée sur des candidats pour les relais multi-canaux |
| 082 | Pool pump schedule                                  | ✅     | Plugin de recette avec 3 créneaux on/off journaliers                                              |
| 083 | Pool heat pump (Polytropic)                         | ✅     | Type `pool_heat_pump` + plugin d'intégration Modbus (Polytropic Master Inverter)                  |

## Refactor énergétique Shelly (multi-itérations)

| #   | Title                                 | Status   | Résumé                                                                                                                              |
| --- | ------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 084 | Shelly energy — overview              | Planned  | Principes directeurs pour la migration en 4 itérations de Legrand vers Shelly Pro 3EM                                               |
| 085 | Iteration 1 — shelly-em plugin (live) | Planned  | Plugin Sowel : `act_power` live et compteurs par canal, en parallèle de Legrand                                                     |
| 086 | Iteration 2 — Shelly drives roles     | Planned  | Promotion des canaux Shelly en `main_energy_meter` + `energy_production_meter`, retrait de Legrand                                  |
| 087 | Iteration 3 — energydata-stack        | Rejected | Remplacé par l'archive native du Shelly Pro 3EM (60 j in-device) ; voir 088 pour le correctif réel                                  |
| 088 | Iteration 4 — Shelly gap backfill     | Planned  | Le plugin interroge la RPC `EM1Data.GetData` au boot et toutes les heures pour rejouer les minutes manquantes dans le pipeline live |

## V1.5 : graphique par usage, bascules MQTT, recette state-trigger

| #   | Title                                                        | Status | Résumé                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 089 | Security hardening: plugin supply chain & backup path safety | ✅     | Livrée en v1.6.2. Voir `specs/089-security-hardening-supply-chain-backup/`.                                                                                                                                                    |
| 090 | MQTT mapping enable/disable                                  | ✅     | Flag `enabled` par mapping sur les publishers MQTT, en complément de la bascule publisher, pour mettre en sourdine un seul mapping sans perdre sa configuration.                                                               |
| 091 | By-usage consumption chart                                   | ✅     | Nouvel endpoint `GET /energy/by-usage` et bascule Total / Par usage sur la page Énergie qui rend une ventilation empilée par sous-compteur `energy_meter` + un résidu "Other" (`compteur principal - Σ sous-compteurs`).       |
| 092 | State-triggered light recipe                                 | ✅     | Plugin de recette `state-trigger-light` : allume pour une durée fixe quand l'alias `state` d'un équipement atteint une valeur cible, nightOnly optionnel ; ajoute les contraintes de slot `crossZone` et `includeDescendants`. |

## V1.11 : durcissement runtime des plugins

| #   | Titre                                                           | Statut | Résumé                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 094 | UI Redesign (umbrella + Phase 0 palette swap)                   | ✅     | Livrée. Voir `specs/094-ui-redesign/`.                                                                                                                                                                                       |
| 095 | Design System Phase 1: Typography Polish                        | ✅     | Livrée. Voir `specs/095-design-system-typography/`.                                                                                                                                                                          |
| 096 | Design System Phase 2: Sidebar                                  | ✅     | Livrée. Voir `specs/096-design-system-sidebar/`.                                                                                                                                                                             |
| 097 | Design System Phase 3: Strip Pills (Zone Aggregation)           | ✅     | Livrée. Voir `specs/097-design-system-strip-pills/`.                                                                                                                                                                         |
| 098 | Design System Phase 4: Dashboard Widgets                        | ✅     | Livrée. Voir `specs/098-design-system-dashboard/`.                                                                                                                                                                           |
| 099 | Design System Phase 5: Equipment Row                            | ✅     | Livrée. Voir `specs/099-design-system-equipment-row/`.                                                                                                                                                                       |
| 100 | Design System Phase 6: Zone View 2-Column Layout                | ✅     | Livrée. Voir `specs/100-design-system-comportements/`.                                                                                                                                                                       |
| 101 | Activity Feed (Zone view right column)                          | ✅     | Livrée en v1.8.0. Voir `specs/101-design-system-activity-feed/`.                                                                                                                                                             |
| 102 | Design System Phase 8: Recipe Edit Modal + Surcharges par mode  | ✅     | Livrée. Voir `specs/102-design-system-recipe-modal/`.                                                                                                                                                                        |
| 104 | Self-update resilience                                          | ✅     | Livrée en v1.6.3. Voir `specs/104-self-update-resilience/`.                                                                                                                                                                  |
| 105 | WAN Hardening                                                   | ✅     | Durcissement WAN : `@fastify/helmet`, CORS resserré, auth WebSocket obligatoire avec contrôle `Origin`, conteneur non-root via gosu, self-update `docker.sock` en opt-in, auth par défaut sur `/api/v1/*`. Livrée en v1.7.0. |
| 106 | Make the topbar "update available" pill actionable              | ✅     | Livrée en v1.9.0. Voir `specs/106-update-pill-actionable/`.                                                                                                                                                                  |
| 107 | Surface a changelog link per row in the UpdatesSheet            | ✅     | Livrée en v1.10.0. Voir `specs/107-update-row-changelog-link/`.                                                                                                                                                              |
| 108 | Block releases without release notes                            | ✅     | Livrée en v1.10.0. Voir `specs/108-release-notes-required/`.                                                                                                                                                                 |
| 109 | Preserve bound device data/orders across partial re-discoveries | ✅     | Livrée en v1.10.1. Voir `specs/109-device-discovery-preserve-bound/`.                                                                                                                                                        |
| 110 | Category-first binding resolution across the codebase           | ✅     | Livrée en v1.10.3. Voir `specs/110-category-first-binding-resolution/`.                                                                                                                                                      |
| 111 | Isolation soft des plugins                                      | ✅     | Proxies scopés sur les `PluginDeps` de chaque plugin : settings limités à `integration.<own-id>.*`, whitelist d'events, ownership des devices par `integrationId`, confinement des erreurs ; sans condition depuis v1.11.0.  |
| 112 | Handlers de crash process                                       | ✅     | Handlers globaux `uncaughtException` et `unhandledRejection` qui écrivent une ligne `fatal` structurée avant l'exit, pour que Docker relance avec une trace exploitable (audit F03). Livrée en v1.11.1.                      |
| 113 | Journal d'audit                                                 | ✅     | Table SQLite persistante `audit_log` et service `AuditLogger` traçant les actions sensibles, avec endpoint admin-only `GET /api/v1/audit` et rétention 365 jours (audit F13). Livrée en v1.11.1.                             |

## V1.13 : store banne + bridge Somfy RTS

| #   | Titre                          | Statut | Résumé                                                                                                                                                                                                                                  |
| --- | ------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 115 | Store banne + bridge Somfy RTS | ✅     | Type d'équipement `awning` (frère du `shutter`, widgets `awnings`) réutilisant `shutter_position`/`shutter_move`/`set_shutter_position`, commandes `allAwningsExtend/Stop/Retract`, plugin `sowel-plugin-somfy-rts`. Livrée en v1.13.0. |

## V1.14 : UX station météo

| #   | Titre            | Statut | Résumé                                                                                                                                                                                                               |
| --- | ---------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 114 | UX station météo | ✅     | Refonte du widget station météo : section module extérieur, module Netatmo historisé par défaut (`SENSOR_DATA_CATEGORIES`, `CATEGORY_DEFAULTS_ON`), libellés désambiguïsés (`humanBindingLabel`). Livrée en v1.12.0. |

## V1.15 : navigateur calendrier Analyse + répartition sous-compteurs en direct

| #   | Titre                               | Statut       | Résumé                                                                                                                                                                                                                    |
| --- | ----------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 116 | Disponibilité des équipements       | 📝 Brouillon | Propager la disponibilité (hors ligne / dégradé / en ligne) de l'état des appareils vers les équipements, avec badges UI et statut agrégé par zone. Rédigée le 2026-05-24, non démarrée.                                  |
| 117 | Calendrier Analyse + sous-compteurs | ✅           | Navigateur calendrier (jour/sem/mois/année) sur la vue Analyse remplaçant le sélecteur de plage, donut de répartition des sous-compteurs en direct sur la page Énergie, et burger mobile pour Analyse. Livrée en v1.15.0. |
| 118 | Améliorations graphiques Analyse    | 📝 Brouillon | Enveloppe min/max sur les courbes `1h`/`1d`, barres pour les sélections pluie/énergie (`isCumulativeBarChart`), total de pluie journalier correct dans le backfill Netatmo et garde-fous du backfill (`--only=<filter>`). |

## V1.17 - V1.19 : API historique énergie + afficheurs supervisés

| #   | Titre                                          | Statut | Résumé                                                                                                                                                                                                                                    |
| --- | ---------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 119 | Agrégation par période de l'historique énergie | ✅     | Les endpoints d'historique énergie renvoient des buckets pré-agrégés alignés calendrier via un seul `aggregateWindow` InfluxDB au fuseau serveur, avec split HP/HC conservé et nouvelle résolution `"1mo"`. Livrée en v1.17.0.            |
| 120 | Type d'équipement afficheur                    | ✅     | Nouveau type d'équipement `display` pour les écrans supervisés par Sowel (firmware sowel-energy-display) avec page DisplayPanel, réglage langue et luminosité, et famille de widgets `displays`. Livrée en v1.18.0.                       |
| 121 | Plugin MQTT de supervision d'afficheurs        | ✅     | Plugin MQTT compagnon `sowel-plugin-displays` découvrant les afficheurs via un payload `state` retained avec disponibilité LWT, et définissant le contrat `state` + `cmd/<key>` pour l'équipement de la spec 120. Livrée avec la v1.18.0. |
| 122 | Action de réveil des afficheurs                | ✅     | Ajoute l'ordre `display_wake` sans valeur (routé vers `cmd/wake`) qui restaure la luminosité préférée de l'utilisateur depuis la NVS ; les recettes de veille par présence n'ont plus à connaître le niveau. Livrée en v1.19.0.           |

## V1.20 : valorisation en euros + mode ombre

| #   | Titre                        | Statut | Résumé                                                                                                                                                                                                                           |
| --- | ---------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 123 | Valorisation du coût énergie | ✅     | Bascule Wh/€ sur la page Énergie valorisant historique, totaux et répartition par usage en euros via le tarif HP/HC, calculés à la lecture sur `/energy/history` et `/energy/by-usage`. Livrée en v1.20.0.                       |
| 124 | Mode ombre                   | ✅     | `SOWEL_SHADOW_MODE=1` rend un conteneur sûr face à une copie de la production en neutralisant tout ce qui sort (plugins, recettes, publishers, polling GitHub), avec `GET /api/v1/system/mode` et un bandeau. Livrée en v1.20.0. |

## V1.21 - V1.23 : solaire + briques recettes

| #   | Titre                                  | Statut | Résumé                                                                                                                                                                                                                   |
| --- | -------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 125 | Équipement panneau solaire + APsystems | ✅     | Équipement `solar_panel` en lecture seule (un par voie d'onduleur) avec mesures DC, widget et groupe Solaire, plus la catégorie `temperature_device` et le plugin compagnon `sowel-plugin-apsystems`. Livrée en v1.21.0. |
| 126 | Slot select + getSunlight()            | ✅     | Les formulaires de recettes gagnent un slot `select` et la règle `hiddenWhen`, et les recettes `ctx.helpers.getSunlight()` (lever/coucher/jour avec offsets spec 023). Livrée en v1.23.0.                                |

## V1.24 - V1.26 : notifications

| #   | Titre                        | Statut | Résumé                                                                                                                                                                                             |
| --- | ---------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 127 | Notifications Web Push (PWA) | ✅     | Notifications Web Push natives sur la PWA installée, activées par appareil et mappables comme publisher sur toute valeur, avec clés VAPID et abonnements par utilisateur. Livrée en v1.24.0.       |
| 128 | Répétition de notification   | ✅     | Les mappings de notification gagnent une option de re-notification (Aucune / Indéfiniment / Limitée à N) qui renvoie tant que la valeur reste active, distincte de l'anti-spam. Livrée en v1.26.0. |

## V1.27 - V1.30 : mesure, arrosage, RBAC, triphasé

| #   | Titre                                   | Statut | Résumé                                                                                                                                                                                                                              |
| --- | --------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 129 | Interrupteur avec mesure                | ✅     | Une prise/interrupteur affiche puissance et énergie en direct quand l'appareil les remonte, alimentant le dashboard énergie, HP/HC et la répartition en direct ; relais simples inchangés. Livrée en v1.27.0.                       |
| 130 | Jours de semaine par créneau d'arrosage | ✅     | Chaque créneau d'arrosage peut être limité à des jours choisis (vide = tous les jours), ex. 07:30 les jours d'école et 09:00 le week-end. Nouveau champ multi-select de recette rendu en puces. Livré en v1.28.0.                   |
| 131 | RBAC : configuration admin only         | ✅     | Le rôle Standard est limité à voir et actionner, la configuration est réservée à l'admin (403 serveur, masquée dans l'UI) ; amendé par l'issue #912 : un standard peut activer, désactiver et appliquer un mode. Livrée en v1.29.0. |
| 132 | Répartition par phase sur Énergie Live  | ✅     | Barres de puissance par phase sous le diagramme de flux Énergie Live quand le compteur principal porte les liaisons `power_l1/l2/l3`, convention ouverte à toute intégration. Livrée en v1.30.0.                                    |

## V1.31 - V1.34 : caméra, min/max météo, chauffe-eau

| #   | Titre                    | Statut | Résumé                                                                                                                                                                                                        |
| --- | ------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 133 | Type d'équipement caméra | ✅     | Équipement `camera` indépendant du fabricant : instantané rafraîchi, vue en direct HLS à la demande, contrôles surveillance/projecteur/sirène optionnels, médias proxifiés par le backend. Livrée en v1.31.0. |
| 134 | Min/max journalier météo | ✅     | Les stations météo affichent le min et le max mesurés du jour, suivis par Sowel à partir des échantillons reçus, remis à zéro à minuit local et conservés aux redémarrages. Livrée en v1.32.0.                |
| 135 | Équipement chauffe-eau   | ✅     | Nouvel équipement `water_heater` : ON/OFF via le canal relais standard, température de l'eau optionnelle sous son propre alias, puissance/énergie sur relais avec mesure. Livrée en v1.34.0.                  |

## V1.35 : sources personnelles de plugins

| #   | Titre                                                                 | Statut | Résumé                                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 136 | Sources personnelles de plugins                                       | ✅     | Sources de plugins personnelles, troisième niveau de confiance à côté de la spec 089 : un admin ajoute ses dépôts GitHub avec SHA256 épinglé TOFU, via `plugin_sources`, `PersonalSourceManager` et `/api/v1/plugins/sources` (#367). Livrée en v1.35.0.   |
| 137 | Plugins Page: Recipe Categories and Search                            | ✅     | La page Plugins regroupe les recettes sous une enum fermée `category` (registre + manifestes) et ajoute une recherche partagée localisée insensible aux accents ; `getStore()` transmet `i18n`/`tags` du registre. Livrée en v1.36.0.                      |
| 138 | Read-only tariff helper for recipes                                   | ✅     | `ctx.helpers.getTariff()` donne aux recettes une copie en lecture seule du planning HP/HC issue du `TariffClassifier` (modèle spec 126), sans les prix ; `slotRanges()`/`isWithinSlot()` extraits (#379). Livrée en v1.37.0.                               |
| 139 | Zone-qualified equipment pickers in recipe forms                      | ✅     | Les sélecteurs de recettes nomment les zones par le plus court suffixe d'ancêtres qui distingue les homonymes, via `ui/src/lib/zone-path.ts` et des composants partagés ; UI seule (issue #385). Livrée en v1.37.1.                                        |
| 140 | Energy Capacity Arbiter                                               | ✅     | Arbitre central du surplus solaire entre charges flexibles (réservations, priorités, API recette `ctx.helpers.energy.claimCapacity()`, surface d'arbitrage dans Énergie → Live) ; désactivé par défaut, phase 1 sans ordres. Livrée en v1.39.0.            |
| 141 | Spec 141: Order Delivery Confirmation                                 | ✅     | `OrderConfirmationTracker` vérifie que chaque ordre confirmable se reflète dans les données, sinon émet `equipment.order.unconfirmed`, lève une alarme warning et réessaie une fois au retour en ligne (issue #398). Livrée en v1.39.0.                    |
| 142 | Zone paths in the equipments admin list                               | ✅     | Administration › Équipements regroupe par id de zone avec le chemin complet en titre, dans l'ordre de l'arbre (`groupEquipmentsByZone`, `zone-path.ts` de la spec 139) : les zones homonymes ne fusionnent plus ; UI seule. Livrée en v1.37.1.             |
| 143 | Spec 143: Low Battery Alerts                                          | ✅     | Nouveau `BatteryMonitor` : alarme système quand un appareil sur pile (`Device.powerSource`) faiblit, rappel hebdomadaire, `sendSystemAlarm` vers tous les publishers (spec 116, #348) ; `GET /devices/battery-alerts`. Livrée en v1.43.0.                  |
| 144 | States and measurements on one Analyse chart                          | ✅     | Les graphes Analyse mêlent états d'actionneurs (`light_state`, `cover_state`…, désormais famille `states`) et mesures, sur un axe droit `[0, 1]` en escalier ; `familiesCompatible()` assouplit le verrou F7 de la spec 118 ; UI seule. Livrée en v1.42.0. |
| 145 | Series colours and Y axes on the Analyse chart                        | ✅     | Les graphes Analyse gagnent des couleurs de série persistées (`SavedChartSeriesConfig.color`), un axe Y ajusté aux données (`SavedChartConfig.yAxisFit`) et deux axes gauche/droite par unité pour deux grandeurs ; UI seule. Livrée en v1.43.0.           |
| 146 | Confirmation before a sensitive gate action                           | ✅     | Livrée. Voir `specs/146-gate-action-confirmation/`.                                                                                                                                                                                                        |
| 147 | Persist the activity feed and the arbiter decision journal            | ✅     | Livrée. Voir `specs/147-persist-activity-arbiter-history/`.                                                                                                                                                                                                |
| 148 | Energy arbiter UI polish (design-system + redesigned timeline)        | ✅     | Livrée. Voir `specs/148-arbiter-ui-polish/`.                                                                                                                                                                                                               |
| 149 | Dashboard presentation resolver (phase 1)                             | ✅     | Livrée. Voir `specs/149-dashboard-presentation-resolver/`.                                                                                                                                                                                                 |
| 150 | Typed value normalization at ingestion + unified binding candidates   | ✅     | Une autorité de coercition (`shared/value-normalization.ts`) normalise les valeurs au type déclaré dès l'ingestion, `computeBindingCandidates` devient partagé (`shared/binding-candidates.ts`) et `gate` accepte tout relais on/off. Livrée en v1.48.0.   |
| 151 | Two-Factor Authentication (TOTP + Backup Codes)                       | ✅     | Livrée. Voir `specs/151-mfa-totp/`.                                                                                                                                                                                                                        |
| 152 | Equipment solar command channel                                       | ✅     | Livrée en v1.52.0. Voir `specs/152-equipment-solar-command/`.                                                                                                                                                                                              |
| 153 | VMC (2-speed ventilation) equipment type                              | ✅     | Nouveau type d'équipement `vmc` (OFF / V1 / V2) liant des relais sous les alias `low` et `high`, avec ordres de vitesse break-before-make dans `src/equipments/vmc-controller.ts` et une UI complète. Livrée en v1.52.0.                                   |
| 154 | Per-equipment invert direction for shutter-family equipments          | ✅     | Livrée en v1.52.5. Voir `specs/154-shutter-invert/`.                                                                                                                                                                                                       |
| 155 | Invert Direction for Boolean Gate Triggers (issue #627)               | ✅     | Livrée. Voir `specs/155-gate-invert-direction/`.                                                                                                                                                                                                           |
| 156 | UPS (uninterruptible power supply) equipment type                     | ✅     | Nouveau type d'équipement `ups` en lecture seule (`ups_status`, `battery_runtime`, `ups_load`), sans ordres, le plugin déclare `powerSource: "mains"` (specs 120, 143) ; plugin compagnon `sowel-plugin-nut`. Livrée en v1.53.0.                           |
| 157 | Shared FlowDiagram, and the UPS panel rebuilt on it                   | ✅     | Extrait le diagramme de flux d'Énergie · Live (spec 148) en un `FlowDiagram` partagé (`ui/src/components/flow/`) et reconstruit dessus le panneau UPS de la spec 156 en trois cartes. Livrée en v1.54.0.                                                   |
| 158 | Arbiter baseline metrics                                              | ✅     | Métriques quotidiennes de référence pour l'arbitre de la spec 140 (cycles courts, temps accordé, surplus manqué) sans toucher `capacity-arbiter.ts`, via `GET /api/v1/energy/arbiter/metrics` et `scripts/energy/arbiter-metrics.ts`. Livrée en v1.55.0.   |
| 159 | Weather forecast: multi-model and ensemble confidence                 | ✅     | Le plugin de prévision météo moyenne plusieurs modèles Open-Meteo par variable et tire de l'API ensemble un indicateur de confiance haute/moyenne/basse et une probabilité de pluie (plugin 2.0.0/2.1.0). Livrée en v1.56.0.                               |
| 160 | PV production forecast                                                | ✅     | Prévision horaire de production PV à J+5 pour les pans déclarés, apprise chaque nuit sur l'historique de l'installation, points persistés pour être évalués ; nécessite le plugin weather-forecast 2.2.0. Livrée en v1.57.0.                               |
| 161 | Fit the PV model from existing history                                | ✅     | Action explicite qui ajuste tout de suite le modèle PV de la spec 160 sur la production enregistrée et l'irradiance passée, bornée par une date « inchangé depuis » optionnelle ; nécessite le plugin weather-forecast 2.3.0. Livrée en v1.57.0.           |
| 162 | Tell the household when the panels stop performing                    | ✅     | Contrôle quotidien de santé PV sur le prévisionniste de la spec 160 : rendement des heures claires de midi face à une référence haut centile, alerte persistée en cas de sous-performance. Livrée en v1.58.0.                                              |
| 163 | PV monitoring and configuration find their place                      | ✅     | Déplace les panneaux de prévision et de santé PV des specs 160/161/162 vers Énergie → Production, et la déclaration et le recalage vers Réglages → Énergie, avec un lien profond `?tab=` ; aucun changement backend. Livrée en v1.58.0.                    |
| 164 | Granted-but-idle on the arbiter timeline                              | ✅     | Le ruban de l'arbitre gagne un état `granted-idle` tiré de la puissance propre de chaque charge accordée, journal `draw-stopped` / `draw-started` (#732, #631, #733) ; observation seule, métriques spec 158 inchangées. Livrée en v1.59.0.                |
| 165 | One load-state model for the arbitration surface                      | ✅     | Un seul modèle `ArbiterLoadState` issu de `getPublicState()` alimente le tableau et le ruban spec 164 de l'arbitre, racine i18n `arbiter.loadState.*` (spec 158, #732, #577) ; lecture et présentation seulement. Livrée en v1.59.0.                       |
| 166 | Claimant-declared need for a granted load                             | ✅     | `CapacityClaimHandle` gagne `reportNeed(boolean)` : la recette déclare si sa charge accordée a besoin de puissance sans compteur propre ; une mesure fraîche l'emporte (amende la spec 164, #732). Livrée en v1.60.0.                                      |
| 167 | Documentation currency gates                                          | ✅     | Livrée. Voir `specs/167-documentation-currency/`.                                                                                                                                                                                                          |
| 168 | Widget prévisions : bande 5 jours et panneau détail                   | ✅     | Livrée. Voir `specs/168-forecast-widget-five-days/`.                                                                                                                                                                                                       |
| 169 | Tuile Dashboard pour une instance de recette                          | ✅     | Livrée. Voir `specs/169-dashboard-recipe-widget/`.                                                                                                                                                                                                         |
| 170 | Une zone somme la puissance que ses sous-compteurs mesurent           | ✅     | Livrée. Voir `specs/170-zone-power-aggregate/`.                                                                                                                                                                                                            |
| 171 | Un clic sur une tuile de recette déclenche sa commande                | ✅     | Une tuile de recette (spec 169) n'ayant qu'une commande la déclenche depuis toute la carte (modèle spec 098), confirmation par `tile.confirmFrom` (`requireConfirmation` spec 146), `confirmParam` ou `tile.confirm`. Livrée.                              |
| 172 | Le panneau des mises à jour sait terminer une mise à jour personnelle | ✅     | Livrée. Voir `specs/172-updates-sheet-personal-confirm/`.                                                                                                                                                                                                  |
| 173 | Un compteur qui se trouve à l'intérieur d'un autre                    | ✅     | Livrée. Voir `specs/173-nested-submeters/`.                                                                                                                                                                                                                |
| 174 | Une action minutée sur un équipement actionnable                      | ✅     | Phases 1 et 2 : un retour persisté porté par le moteur (agir puis revenir après N minutes) via `executeOrder`, à la place des horloges de `motion-light`, `state-trigger-light`, `delivery-gate` (specs 141, 150, 154, 149, #325).                         |
| 175 | Une mesure de puissance est jugée sur sa propre cadence               | ✅     | La fraîcheur d'une puissance est dérivée de la cadence observée ou déclarée de la source et portée sur la liaison en `freshnessBudgetMs`, commune à toutes les surfaces live ; supprime l'alias `demand_5min`. Fenêtres spec 116 inchangées.               |
| 176 | L'état de marche d'un thermostat a son propre alias                   | ✅     | Le booléen marche/arrêt d'un thermostat sous-compté se lie sous `state` (`appliance_state`, spec 152) au lieu du wattage `power` de la spec 077, ce qui corrige le toggle instable (#901, panasonic-cc 2.3.2).                                             |
| 177 | Ce qu'est un thermostat ; les extras rendus comme des extras          | ✅     | Déclare le cœur du thermostat une fois dans `src/shared/thermostat-contract.ts` (suite de la spec 176), le détecte par la catégorie `setpoint`, ajoute `operation_mode` et rend les extras génériquement ; #919 partie 1, #922 partie 2.                   |
| 178 | Appuyer encore demande plus longtemps, puis abandonne                 | ✅     | Amende la spec 174 : un équipement peut déclarer des paliers de durées (`durationStepsMs`) ; chaque appui monte d'un palier (persisté dans `timed_actions.step_index`) et un appui au-delà du dernier abandonne l'échéance sans retour.                    |
| 179 | Un compteur alimenté par un autre réseau                              | ✅     | `Equipment.separateSupply` marque un compteur alimenté par un autre abonnement ; répartition et donut live spec 117 l'affichent à part, en kWh, jamais en € (specs 123, 170), jamais parent spec 173 (#523).                                               |
| 181 | Accès partagés : laisser quelqu'un ouvrir un portail, pour un temps   | ✅     | Implémentée sur `feat/shared-access`, en revue sur la PR #970 : fonctionnalité du cœur optionnelle permettant à un non-utilisateur d'ouvrir un portail sur des créneaux avec un code ou un lien, via une page publique et une API plugin ; remplace #969.  |
| 182 | Type d'équipement borne de recharge VE                                | ✅     | Nouveau type `ev_charger` déclaré dans `src/shared/ev-charger-contract.ts` (modèle de la spec 177) avec les catégories `ev_vehicle_state`, `ev_charge_current`, `ev_session_energy` et `set_ev_charge_current` ; premier device `sowel-plugin-tuya`.       |
| 183 | Type d'équipement véhicule électrique                                 | ✅     | Nouveau type `electric_vehicle` déclaré par un module de contrat, avec batterie, autonomie, branchement, état de charge, commandes `wake`/`charge_start` et onze catégories `ev_*` ; jamais sous-compteur ; premier plugin `sowel-plugin-renault`.         |
| 184 | Commande `refresh` du véhicule électrique                             | ✅     | Amende la spec 183 : commande ponctuelle optionnelle `refresh` (catégorie `ev_refresh`) demandant au plugin de relire le dernier relevé de la voiture sans la réveiller.                                                                                   |
| 185 | Demande de capacité modulable                                         | ✅     | Amende la spec 140 : une demande de capacité peut déclarer une plage (`minW`, `maxW`, `stepW`) et reçoit un budget qui suit le surplus via `onBudget` ; premier utilisateur : la recette de recharge VE.                                                   |
| 186 | Tuile du pluviomètre                                                  | ✅     | Un équipement `weather` qui ne mesure que la pluie affiche la pluie du jour et sur 24 h sur sa tuile, cumuls 7/30 jours et histogramme dans sa fiche ; la phase 2 garde la pluie horaire un an dans `sowel-rain-hourly`. Livrée en v1.74.0.                |
| 187 | Accès partagés : jours de la semaine                                  | ✅     | Une plage horaire d’un accès partagé peut nommer ses jours (« tous les vendredis 18:00–22:00 ») ; sans jours, tous les jours, donc rien à migrer. L’éditeur replie les jours ; la page de l’invité dit le jour de la prochaine ouverture.                  |
| 188 | Accusé de réception des ordres                                        | ✅     | Un appareil qui répond (LoRa) dit ce qu’il a fait de chaque ordre : ligne d’état sur la tuile et la fiche, alarme si refusé, perdu ou non confirmé ; la page de l’invité montre son propre appui. Jamais de renvoi.                                        |

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
