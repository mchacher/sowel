# Référence API

Sowel expose une API REST sous `/api/v1/` et un endpoint WebSocket à `/ws`. Tous les endpoints requièrent une authentification, sauf mention contraire. Les réponses sont en JSON.

**Base URL** : `http://<host>:3000`

**Authentification** : passez un token d'accès JWT en header `Authorization: Bearer <token>`, ou un token d'API en `Authorization: Bearer swl_<token>`.

---

## Sommaire

- [Authentication](#authentication)
- [Current User (Me)](#current-user-me)
- [Users (Admin)](#users-admin)
- [Devices](#devices)
- [Equipments](#equipments)
- [Zones](#zones)
- [Modes](#modes)
- [Calendar](#calendar)
- [Recipes](#recipes)
- [Dashboard](#dashboard)
- [Charts](#charts)
- [Energy](#energy)
- [History](#history)
- [Integrations (Admin)](#integrations-admin)
- [Plugins (Admin)](#plugins-admin)
- [Settings (Admin)](#settings-admin)
- [MQTT Brokers](#mqtt-brokers)
- [MQTT Publishers](#mqtt-publishers)
- [Notification Publishers](#notification-publishers)
- [Button Actions](#button-actions)
- [Activité](#activite)
- [Logs (Admin)](#logs-admin)
- [Backup (Admin)](#backup-admin)
- [Health](#health)
- [WebSocket](#websocket)

---

## Authentication

Endpoints publics, aucune auth requise pour `status` et `setup`.

| Method | Path                   | Description                                                                                                                                         |
| ------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/auth/status`  | Vérifie si le setup au premier démarrage est requis. Retourne `{ setupRequired: boolean }`.                                                         |
| `POST` | `/api/v1/auth/setup`   | Crée le premier utilisateur admin (premier démarrage uniquement). Body : `{ username, password, displayName, language? }`. Retourne les tokens JWT. |
| `POST` | `/api/v1/auth/login`   | Authentification. Body : `{ username, password }`. Retourne `{ accessToken, refreshToken }`. Limité : 10 req/min.                                   |
| `POST` | `/api/v1/auth/refresh` | Rafraîchit le token d'accès. Body : `{ refreshToken }`. Retourne une nouvelle paire de tokens.                                                      |
| `POST` | `/api/v1/auth/logout`  | Invalide le refresh token. Body : `{ refreshToken }`. Retourne 204.                                                                                 |

---

## Current User (Me)

Profil et tokens de l'utilisateur authentifié.

| Method   | Path                     | Description                                                                                          |
| -------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/me`             | Récupère le profil de l'utilisateur courant.                                                         |
| `PUT`    | `/api/v1/me`             | Met à jour le nom d'affichage. Body : `{ displayName }`.                                             |
| `PUT`    | `/api/v1/me/preferences` | Met à jour les préférences (langue, thème, etc.). Body : `{ preferences }`.                          |
| `PUT`    | `/api/v1/me/password`    | Change le mot de passe. Body : `{ currentPassword, newPassword }`.                                   |
| `GET`    | `/api/v1/me/tokens`      | Liste les tokens d'API personnels.                                                                   |
| `POST`   | `/api/v1/me/tokens`      | Crée un token d'API. Body : `{ name, expiresAt? }`. Retourne la chaîne de token (affichée une fois). |
| `DELETE` | `/api/v1/me/tokens/:id`  | Révoque un token d'API. Retourne 204.                                                                |

---

## Users (Admin)

Toutes les routes de gestion des utilisateurs nécessitent le rôle admin.

| Method   | Path                | Description                                                                                         |
| -------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/users`     | Liste tous les utilisateurs.                                                                        |
| `POST`   | `/api/v1/users`     | Crée un utilisateur. Body : `{ username, password, displayName, role }`.                            |
| `PUT`    | `/api/v1/users/:id` | Met à jour un utilisateur. Body : `{ displayName?, role?, enabled? }`.                              |
| `DELETE` | `/api/v1/users/:id` | Supprime un utilisateur. Impossible de se supprimer ou de supprimer le dernier admin. Retourne 204. |

---

## Devices

| Method   | Path                             | Description                                                                                 |
| -------- | -------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/devices`                | Liste tous les devices avec leurs données et ordres courants.                               |
| `GET`    | `/api/v1/devices/:id`            | Récupère un device avec données et ordres.                                                  |
| `PUT`    | `/api/v1/devices/:id`            | Met à jour un device. Body : `{ name?, zoneId? }`.                                          |
| `DELETE` | `/api/v1/devices/:id`            | Supprime un device. Retourne 204.                                                           |
| `GET`    | `/api/v1/devices/suggest`        | Suggère les devices compatibles avec un type d'équipement. Query : `?type=<equipmentType>`. |
| `GET`    | `/api/v1/devices/battery-alerts` | Alertes de batterie faible actives (spec 143). Liste de `BatteryAlert`.                     |
| `GET`    | `/api/v1/devices/:id/raw`        | Récupère les données expose brutes de l'intégration pour un device.                         |

---

## Equipments

| Method   | Path                                   | Description                                                                                                                                                                                                      |
| -------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/equipments`                   | Liste tous les équipements avec leurs liaisons et données courantes. Paramètre optionnel `?type=<EquipmentType>` pour filtrer sur un seul type (ex. `energy_meter`). Une valeur inconnue renvoie une liste vide. |
| `GET`    | `/api/v1/equipments/:id`               | Récupère un équipement avec liaisons et données courantes.                                                                                                                                                       |
| `POST`   | `/api/v1/equipments`                   | Crée un équipement. Body : `{ name, type, zoneId, icon?, description?, deviceIds? }`. Si `deviceIds` est fourni, des liaisons automatiques sont créées.                                                          |
| `PUT`    | `/api/v1/equipments/:id`               | Met à jour un équipement. Body : `{ name?, type?, zoneId?, icon?, description?, enabled? }`.                                                                                                                     |
| `DELETE` | `/api/v1/equipments/:id`               | Supprime un équipement. Retourne 204.                                                                                                                                                                            |
| `POST`   | `/api/v1/equipments/:id/orders/:alias` | Exécute un ordre d'équipement. Body : `{ value }`.                                                                                                                                                               |

### Data Bindings

| Method   | Path                                              | Description                                              |
| -------- | ------------------------------------------------- | -------------------------------------------------------- |
| `POST`   | `/api/v1/equipments/:id/data-bindings`            | Ajoute un DataBinding. Body : `{ deviceDataId, alias }`. |
| `DELETE` | `/api/v1/equipments/:id/data-bindings/:bindingId` | Supprime un DataBinding. Retourne 204.                   |

### Order Bindings

| Method   | Path                                               | Description                                                |
| -------- | -------------------------------------------------- | ---------------------------------------------------------- |
| `POST`   | `/api/v1/equipments/:id/order-bindings`            | Ajoute un OrderBinding. Body : `{ deviceOrderId, alias }`. |
| `DELETE` | `/api/v1/equipments/:id/order-bindings/:bindingId` | Supprime un OrderBinding. Retourne 204.                    |

---

## Zones

| Method   | Path                                 | Description                                                                                        |
| -------- | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/zones`                      | Liste toutes les zones en arborescence.                                                            |
| `GET`    | `/api/v1/zones/:id`                  | Récupère une zone avec ses enfants.                                                                |
| `POST`   | `/api/v1/zones`                      | Crée une zone. Body : `{ name, parentId?, icon?, description?, displayOrder? }`.                   |
| `PUT`    | `/api/v1/zones/:id`                  | Met à jour une zone. Body : `{ name?, parentId?, icon?, description?, displayOrder? }`.            |
| `DELETE` | `/api/v1/zones/:id`                  | Supprime une zone. Retourne 204.                                                                   |
| `PUT`    | `/api/v1/zones/reorder`              | Réordonne des zones de même niveau. Body : `{ parentId, orderedIds }`. Retourne 204.               |
| `GET`    | `/api/v1/zones/aggregation`          | Récupère les données agrégées de toutes les zones (température, mouvement, lightsOn, etc.).        |
| `POST`   | `/api/v1/zones/:id/orders/:orderKey` | Exécute un ordre au niveau zone (par ex. `allLightsOff`, `allShuttersClose`). Body : `{ value? }`. |

---

## Modes

| Method   | Path                                      | Description                                                  |
| -------- | ----------------------------------------- | ------------------------------------------------------------ |
| `GET`    | `/api/v1/modes`                           | Liste tous les modes avec détails.                           |
| `GET`    | `/api/v1/modes/:id`                       | Récupère un mode avec impacts et état.                       |
| `POST`   | `/api/v1/modes`                           | Crée un mode. Body : `{ name, icon?, description? }`.        |
| `PUT`    | `/api/v1/modes/:id`                       | Met à jour un mode. Body : `{ name?, icon?, description? }`. |
| `DELETE` | `/api/v1/modes/:id`                       | Supprime un mode. Retourne 204.                              |
| `POST`   | `/api/v1/modes/:id/activate`              | Active le mode.                                              |
| `POST`   | `/api/v1/modes/:id/deactivate`            | Désactive le mode.                                           |
| `POST`   | `/api/v1/modes/:id/apply-to-zone/:zoneId` | Applique les impacts du mode à une zone spécifique.          |

### Zone Mode Impacts

| Method   | Path                                 | Description                                                                         |
| -------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/zones/:zoneId/mode-impacts` | Récupère les impacts de mode d'une zone.                                            |
| `PUT`    | `/api/v1/modes/:id/impacts/:zoneId`  | Définit les actions d'impact de zone. Body : `{ actions: ZoneModeImpactAction[] }`. |
| `DELETE` | `/api/v1/modes/:id/impacts/:zoneId`  | Supprime un impact de zone. Retourne 204.                                           |

### Mode Triggers

| Method | Path                         | Description                                              |
| ------ | ---------------------------- | -------------------------------------------------------- |
| `GET`  | `/api/v1/modes/:id/triggers` | Récupère les liaisons de bouton qui déclenchent ce mode. |

---

## Calendar

| Method   | Path                                  | Description                                                     |
| -------- | ------------------------------------- | --------------------------------------------------------------- |
| `GET`    | `/api/v1/calendar/profiles`           | Liste tous les profils de calendrier.                           |
| `GET`    | `/api/v1/calendar/active`             | Récupère le profil actif et ses créneaux.                       |
| `PUT`    | `/api/v1/calendar/active`             | Définit le profil actif. Body : `{ profileId }`.                |
| `GET`    | `/api/v1/calendar/profiles/:id/slots` | Liste les créneaux d'un profil.                                 |
| `POST`   | `/api/v1/calendar/profiles/:id/slots` | Ajoute un créneau. Body : `{ days, time, modeActions }`.        |
| `PUT`    | `/api/v1/calendar/slots/:slotId`      | Met à jour un créneau. Body : `{ days?, time?, modeActions? }`. |
| `DELETE` | `/api/v1/calendar/slots/:slotId`      | Supprime un créneau. Retourne 204.                              |

---

## Recipes

### Recipe Definitions

| Method | Path                        | Description                                              |
| ------ | --------------------------- | -------------------------------------------------------- |
| `GET`  | `/api/v1/recipes`           | Liste les définitions de recettes disponibles (modèles). |
| `GET`  | `/api/v1/recipes/:recipeId` | Récupère une définition de recette avec slots et i18n.   |

### Recipe Instances

| Method   | Path                                   | Description                                                              |
| -------- | -------------------------------------- | ------------------------------------------------------------------------ |
| `GET`    | `/api/v1/recipe-instances`             | Liste toutes les instances de recettes actives.                          |
| `POST`   | `/api/v1/recipe-instances`             | Crée une instance. Body : `{ recipeId, params }`.                        |
| `PUT`    | `/api/v1/recipe-instances/:id`         | Met à jour les params de l'instance. Body : `{ params }`.                |
| `DELETE` | `/api/v1/recipe-instances/:id`         | Arrête et supprime l'instance. Retourne 204.                             |
| `POST`   | `/api/v1/recipe-instances/:id/enable`  | Active une instance désactivée.                                          |
| `POST`   | `/api/v1/recipe-instances/:id/disable` | Désactive (met en pause) une instance en cours.                          |
| `POST`   | `/api/v1/recipe-instances/:id/actions` | Envoie une action à une recette en cours. Body : `{ action, payload? }`. |
| `GET`    | `/api/v1/recipe-instances/:id/log`     | Récupère le journal d'exécution. Query : `?limit=50`.                    |

---

## Dashboard

| Method   | Path                              | Description                                                                                         |
| -------- | --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/dashboard/widgets`       | Liste tous les widgets du tableau de bord, ordonnés par display order.                              |
| `POST`   | `/api/v1/dashboard/widgets`       | Crée un widget (admin). Body : `{ type, equipmentId?, zoneId?, family?, label?, icon? }`.           |
| `PATCH`  | `/api/v1/dashboard/widgets/:id`   | Met à jour le label, l'icône ou la config d'un widget (admin). Body : `{ label?, icon?, config? }`. |
| `DELETE` | `/api/v1/dashboard/widgets/:id`   | Supprime un widget (admin). Retourne 204.                                                           |
| `PUT`    | `/api/v1/dashboard/widgets/order` | Réordonne les widgets (admin). Body : `{ order: string[] }`.                                        |

---

## Charts

| Method   | Path                 | Description                                           |
| -------- | -------------------- | ----------------------------------------------------- |
| `GET`    | `/api/v1/charts`     | Liste les configurations de graphiques sauvegardées.  |
| `GET`    | `/api/v1/charts/:id` | Récupère une configuration de graphique.              |
| `POST`   | `/api/v1/charts`     | Crée un graphique. Body : `{ name, config }`.         |
| `PUT`    | `/api/v1/charts/:id` | Met à jour un graphique. Body : `{ name?, config? }`. |
| `DELETE` | `/api/v1/charts/:id` | Supprime un graphique. Retourne 204.                  |

---

## Energy

| Method | Path                             | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/energy/status`          | Statut du module énergie (disponibilité, sources, `tariffConfigured`). Spec 123 : `tariffConfigured` vaut `true` ssi au moins un de `prices.hp` / `prices.hc` est > 0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `GET`  | `/api/v1/energy/history`         | Interroge l'historique d'énergie. Query : `?period=day&date=2026-01-15`. Périodes : `day`, `week`, `month`, `year`. Retourne la ventilation HP/HC et les données de production. **Spec 123** : chaque point et les totaux portent aussi `cost_hp` / `cost_hc` / `cost_total` (€, 4 décimales), calculés au moment de la requête à partir des `TariffPrices` courants. Coût par point = consommation brute × prix ; coût des totaux = consommation côté réseau (autoconso soustraite) × prix. Si aucun tarif n'est configuré, tous les champs de coût valent 0.                                                                                                    |
| `GET`  | `/api/v1/energy/by-usage`        | Séries temporelles de consommation par sous-compteur pour les mêmes buckets de période que `/energy/history`. Query : `?period=day&date=2026-01-15`. Retourne une série par sous-compteur `energy_meter` plus un résidu `other` (`max(0, total - Σ submeters)`) et les totaux par équipement. **Spec 123** : chaque `SubmeterSeries` porte un `cost` (€) et `totals` ajoute `costByEquipment` / `otherCost` / `totalCost` (€). Les coûts utilisent un taux €/kWh moyen pondéré sur la période = `cost_total / (total_consumption / 1000)` dérivé des totaux de `/energy/history`. Sans compteur principal ou sans consommation, tous les champs de coût valent 0. |
| `GET`  | `/api/v1/settings/energy/tariff` | Récupère la configuration tarifaire (grilles HP/HC et prix).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `PUT`  | `/api/v1/settings/energy/tariff` | Met à jour la configuration tarifaire. Body : `{ schedules, prices }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

---

## History

| Method | Path                                               | Description                                                                                                                    |
| ------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/v1/history/status`                           | Statut du module historique (connexion, nombre de bindings historisés, stats).                                                 |
| `GET`  | `/api/v1/history/retention`                        | Statut de rétention et de downsampling pour tous les buckets/tâches InfluxDB.                                                  |
| `GET`  | `/api/v1/history/bindings/:equipmentId`            | Liste les réglages d'historisation des data bindings d'un équipement.                                                          |
| `PUT`  | `/api/v1/history/bindings/:equipmentId/:bindingId` | Définit le flag d'historisation. Body : `{ historize }` (null, 0 ou 1).                                                        |
| `GET`  | `/api/v1/history/sparkline/zone/:zoneId/:category` | Données de sparkline 24 h au niveau zone (par ex. tendance de température).                                                    |
| `GET`  | `/api/v1/history/sparkline/:equipmentId/:alias`    | Données de sparkline 24 h au niveau équipement.                                                                                |
| `GET`  | `/api/v1/history/:equipmentId`                     | Liste les alias historisés pour un équipement.                                                                                 |
| `GET`  | `/api/v1/history/:equipmentId/:alias`              | Interroge les données de série temporelle. Query : `?from=-24h&to=&aggregation=auto`. Agrégations : `raw`, `1h`, `1d`, `auto`. |

---

## Integrations (Admin)

Routes admin uniquement pour gérer les plugins d'intégration de devices.

| Method | Path                               | Description                                                               |
| ------ | ---------------------------------- | ------------------------------------------------------------------------- |
| `GET`  | `/api/v1/integrations`             | Liste toutes les intégrations avec statut, réglages et nombre de devices. |
| `POST` | `/api/v1/integrations/:id/start`   | Démarre une intégration.                                                  |
| `POST` | `/api/v1/integrations/:id/stop`    | Arrête une intégration.                                                   |
| `POST` | `/api/v1/integrations/:id/restart` | Redémarre une intégration (stop + start).                                 |
| `POST` | `/api/v1/integrations/:id/refresh` | Force un refresh des données (intégrations en polling uniquement).        |

---

## Plugins (Admin)

Routes admin uniquement pour la gestion des plugins tiers.

| Method | Path                             | Description                                                                               |
| ------ | -------------------------------- | ----------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/plugins`                | Liste les plugins installés.                                                              |
| `GET`  | `/api/v1/plugins/store`          | Liste les plugins disponibles (registre + sources personnelles, chacun avec un `tier`).   |
| `POST` | `/api/v1/plugins/store/refresh`  | Force le rafraîchissement du registre et des caches de releases des sources perso.        |
| `GET`  | `/api/v1/plugins/sources`        | Liste les sources personnelles de plugins (spec 136).                                     |
| `POST` | `/api/v1/plugins/sources`        | Ajoute une source personnelle. Body : `{ repo }` (`owner/repo` GitHub public).            |
| `POST` | `/api/v1/plugins/sources/remove` | Retire une source personnelle. Body : `{ repo }`. Les plugins installés sont conservés.   |
| `POST` | `/api/v1/plugins/install`        | Installe depuis GitHub. Body : `{ repo, confirmed?, expectedSha256? }`.                   |
| `POST` | `/api/v1/plugins/:id/update`     | Met à jour un plugin. Body : `{ confirmed?, expectedSha256? }` (paquets perso seulement). |
| `POST` | `/api/v1/plugins/:id/uninstall`  | Désinstalle un plugin.                                                                    |
| `POST` | `/api/v1/plugins/:id/enable`     | Active un plugin (le charge et le démarre).                                               |
| `POST` | `/api/v1/plugins/:id/disable`    | Désactive un plugin (le stoppe et le décharge).                                           |

!!! note "Poignées de confirmation (409)"
`install` et `update` répondent `409` quand une confirmation explicite est requise :

    - `CommunityPluginConfirmationRequired` (spec 089) : plugin du registre publié par un owner non officiel. Réessayer avec `confirmed: true`.
    - `PersonalPluginConfirmationRequired` (spec 136) : plugin issu d'une source personnelle. La réponse contient `{ repo, owner, version, sha256 }` calculés depuis le tarball réel. Réessayer avec `confirmed: true` et `expectedSha256` égal au hash approuvé ; le tarball retéléchargé doit correspondre, et le hash est ensuite épinglé pour les vérifications d'intégrité futures.

---

## Settings (Admin)

Stockage clé-valeur des réglages admin (utilisé pour les configs d'intégration, les réglages maison, etc.).

| Method | Path               | Description                                                                 |
| ------ | ------------------ | --------------------------------------------------------------------------- |
| `GET`  | `/api/v1/settings` | Récupère tous les réglages.                                                 |
| `PUT`  | `/api/v1/settings` | Met à jour les réglages. Body : objet clé-valeur `{ "key": "value", ... }`. |

---

## MQTT Brokers

Brokers MQTT externes pour la publication sortante.

| Method   | Path                       | Description                                                           |
| -------- | -------------------------- | --------------------------------------------------------------------- |
| `GET`    | `/api/v1/mqtt-brokers`     | Liste tous les brokers MQTT.                                          |
| `POST`   | `/api/v1/mqtt-brokers`     | Crée un broker. Body : `{ name, url, username?, password? }`.         |
| `PUT`    | `/api/v1/mqtt-brokers/:id` | Met à jour un broker. Body : `{ name?, url?, username?, password? }`. |
| `DELETE` | `/api/v1/mqtt-brokers/:id` | Supprime un broker. Retourne 204.                                     |

---

## MQTT Publishers

Publishers MQTT sortants qui poussent les données Sowel vers des brokers externes. Chaque publisher cible un seul topic MQTT et peut avoir plusieurs mappings de données (sources équipement, zone, ou recette). Quand `onChangeOnly` est activé, le publisher ne publie que lorsqu'une valeur change réellement, utile pour ne pas inonder les afficheurs externes de heartbeats périodiques.

Chaque mapping porte son propre flag `enabled` (par défaut `true`). Les mappings désactivés sont ignorés en publication live, dans le snapshot initial et dans le bouton manuel "Test", de sorte qu'une source saisonnière peut être mise en sourdine sans perdre son câblage source/clé. Le flag `enabled` au niveau du publisher l'emporte toujours : si le publisher est éteint, tous ses mappings le sont aussi, indépendamment de leur flag par mapping.

| Method   | Path                                              | Description                                                                                                                                                                |
| -------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/mqtt-publishers`                         | Liste tous les publishers avec leurs mappings.                                                                                                                             |
| `GET`    | `/api/v1/mqtt-publishers/:id`                     | Récupère un publisher avec ses mappings.                                                                                                                                   |
| `POST`   | `/api/v1/mqtt-publishers`                         | Crée un publisher. Body : `{ name, brokerId, topic, enabled?, onChangeOnly? }`.                                                                                            |
| `PUT`    | `/api/v1/mqtt-publishers/:id`                     | Met à jour un publisher. Body : `{ name?, brokerId?, topic?, enabled?, onChangeOnly? }`.                                                                                   |
| `DELETE` | `/api/v1/mqtt-publishers/:id`                     | Supprime un publisher. Retourne 204.                                                                                                                                       |
| `POST`   | `/api/v1/mqtt-publishers/:id/test`                | Test : publie un snapshot.                                                                                                                                                 |
| `POST`   | `/api/v1/mqtt-publishers/:id/mappings`            | Ajoute un mapping de données. Body : `{ publishKey, sourceType, sourceId, sourceKey, enabled? }`. `enabled` par défaut à `true` si omis.                                   |
| `PUT`    | `/api/v1/mqtt-publishers/:id/mappings/:mappingId` | Met à jour un mapping. Accepte `{ publishKey?, sourceType?, sourceId?, sourceKey?, enabled? }`. Le flag `enabled` bascule la publication on/off sans supprimer le mapping. |
| `DELETE` | `/api/v1/mqtt-publishers/:id/mappings/:mappingId` | Supprime un mapping. Retourne 204.                                                                                                                                         |

---

## Notification Publishers

Notifications push (actuellement Telegram) déclenchées par des changements de données.

| Method   | Path                                                      | Description                                                                                             |
| -------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/notification-publishers`                         | Liste tous les notification publishers avec leurs mappings.                                             |
| `GET`    | `/api/v1/notification-publishers/:id`                     | Récupère un publisher avec ses mappings.                                                                |
| `POST`   | `/api/v1/notification-publishers`                         | Crée un publisher. Body : `{ name, channelType, channelConfig, enabled? }`.                             |
| `PUT`    | `/api/v1/notification-publishers/:id`                     | Met à jour un publisher.                                                                                |
| `DELETE` | `/api/v1/notification-publishers/:id`                     | Supprime un publisher. Retourne 204.                                                                    |
| `POST`   | `/api/v1/notification-publishers/:id/test-channel`        | Teste le canal de notification (envoie un message de test).                                             |
| `POST`   | `/api/v1/notification-publishers/:id/test`                | Teste le publisher complet (déclenche les mappings).                                                    |
| `POST`   | `/api/v1/notification-publishers/:id/mappings`            | Ajoute un mapping de déclenchement. Body : `{ message, sourceType, sourceId, sourceKey, throttleMs? }`. |
| `PUT`    | `/api/v1/notification-publishers/:id/mappings/:mappingId` | Met à jour un mapping.                                                                                  |
| `DELETE` | `/api/v1/notification-publishers/:id/mappings/:mappingId` | Supprime un mapping. Retourne 204.                                                                      |

---

## Button Actions

Mappe les appuis sur des boutons physiques (boutons Zigbee, etc.) à des actions (activation de mode, ordres d'équipement, basculement de recette).

| Method   | Path                                                | Description                                                                                                                                         |
| -------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/equipments/:id/action-bindings`            | Liste les action bindings d'un équipement bouton.                                                                                                   |
| `POST`   | `/api/v1/equipments/:id/action-bindings`            | Crée une liaison. Body : `{ actionValue, effectType, config }`. Types d'effet : `mode_activate`, `mode_toggle`, `equipment_order`, `recipe_toggle`. |
| `PUT`    | `/api/v1/equipments/:id/action-bindings/:bindingId` | Met à jour une liaison.                                                                                                                             |
| `DELETE` | `/api/v1/equipments/:id/action-bindings/:bindingId` | Supprime une liaison. Retourne 204.                                                                                                                 |

---

## Activité

Événements moteur récents pour le panneau d'activité de la vue Zone. Lit depuis le ring buffer en mémoire (rétention 24 h, plafonné à 2000 entrées, remis à zéro au redémarrage). Voir [Zones — Fil d'activité](../user/zones.md#fil-dactivite) pour la description côté utilisateur.

| Method | Path               | Description                                                                                                                       |
| ------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/activity` | Liste les items d'activité. Query : `?zoneId=<uuid>&includeDescendants=true&limit=100`. `limit` est borné à [1, 200], défaut 100. |

Filtrage : les items dont le `zoneId` correspond au paramètre de query sont retournés, plus les items dont le `zoneId` vaut `null` (événements globaux : changements de mode, lever/coucher de soleil, alarmes système). Quand `includeDescendants=true` (défaut), les items des zones enfants sont aussi retournés.

Format de réponse :

```json
{
  "items": [
    {
      "id": "uuid",
      "timestamp": 1715864400000,
      "category": "order",
      "zoneId": "uuid-du-salon",
      "message": {
        "template": "order.executed",
        "params": { "equipmentName": "Lumière", "alias": "state", "value": "ON" }
      },
      "source": { "kind": "recipe", "instanceId": "...", "recipeName": "Motion Light" }
    }
  ]
}
```

Catégories : `order`, `motion`, `recipe`, `mode`, `sunlight`, `alarm`.

Sources : `recipe`, `mode`, `manual`, `button`, `external`. Le champ `source` n'est présent que sur les items `category=order`.

---

## Logs (Admin)

Accès aux logs admin uniquement depuis le ring buffer en mémoire.

| Method | Path                 | Description                                                                                                                                                              |
| ------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/v1/logs`       | Interroge les logs. Query : `?limit=100&level=error&module=mqtt&search=text&since=ISO`. Retourne les entrées, la capacité, le niveau courant et les modules disponibles. |
| `GET`  | `/api/v1/logs/level` | Récupère le niveau de log runtime courant.                                                                                                                               |
| `PUT`  | `/api/v1/logs/level` | Change le niveau de log runtime. Body : `{ level }`. Valides : `debug`, `info`, `warn`, `error`, `fatal`, `silent`.                                                      |

---

## Backup (Admin)

Backup et restauration complète de la configuration, admin uniquement.

| Method | Path             | Description                                                                                                                 |
| ------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/backup` | Exporte la configuration complète. Retourne un ZIP (JSON SQLite + CSV InfluxDB) ou JSON s'il n'y a pas de données InfluxDB. |
| `POST` | `/api/v1/backup` | Restaure la configuration depuis un backup JSON. Body : payload de backup avec `{ version: 1, tables }`.                    |

---

## Health

Aucune authentification requise.

| Method | Path             | Description                                                                                                                              |
| ------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/health` | Vérification de santé du système. Retourne le statut, l'uptime, les statuts d'intégration, le nombre de devices et la version du moteur. |

---

## WebSocket

**Endpoint** : `ws://<host>:3000/ws?token=<jwt_or_api_token>`

L'authentification est passée via le paramètre de query `token`. Les tokens JWT et les tokens d'API (préfixe `swl_`) sont tous deux acceptés.

### Connexion

À la connexion, le serveur envoie un message de bienvenue :

```json
{ "type": "connected", "message": "Connected to Sowel engine", "version": "0.1.0" }
```

Les clients sont automatiquement abonnés au topic `system`.

### S'abonner aux topics

Envoyez un message JSON pour vous abonner à des topics supplémentaires :

```json
{ "type": "subscribe", "topics": ["devices", "equipments", "zones", "modes", "recipes"] }
```

**Topics disponibles** : `devices`, `equipments`, `zones`, `modes`, `recipes`, `calendar`, `mqtt-publishers`, `system`, `logs`, `activity`.

Le topic `system` est toujours inclus, indépendamment de l'abonnement.

### Livraison des événements

Les événements sont batchés toutes les 200 ms et envoyés sous forme de tableau JSON. Les événements de données à haute fréquence sont dédupliqués par batch, seule la dernière valeur par device/équipement/clé de zone est envoyée.

```json
[
  { "type": "device.data.updated", "deviceId": "...", "key": "temperature", "value": 22.5 },
  { "type": "equipment.data.changed", "equipmentId": "...", "alias": "state", "value": "ON" },
  { "type": "zone.data.changed", "zoneId": "...", "key": "temperature", "value": 21.8 }
]
```

### Flux d'activité

Quand on est abonné au topic `activity`, le serveur pousse chaque nouvel item au fil de l'eau. Chaque envoi est un événement unitaire (non batché), avec le même format que les items retournés par `GET /api/v1/activity` :

```json
{
  "type": "activity.added",
  "item": {
    "id": "uuid",
    "timestamp": 1715864400000,
    "category": "motion",
    "zoneId": "uuid-de-zone",
    "message": { "template": "motion.detected", "params": { "equipmentName": "PIR Salon" } }
  }
}
```

Les clients doivent filtrer le flux live par leur scope de zone courant (le serveur diffuse tous les items aux abonnés, sans filtrage par client).

### Streaming de logs

Quand on est abonné au topic `logs`, les entrées de log sont streamées individuellement (non batchées) :

```json
{
  "type": "log.entry",
  "level": "info",
  "module": "devices",
  "msg": "Device discovered",
  "time": 1700000000
}
```
