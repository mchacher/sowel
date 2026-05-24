# Sowel : Modèle de données

> Version : 1.0, 2026-02-19
>
> Ce document est la référence du modèle de données central de Sowel. Il décrit l'architecture en trois couches (Topologie -> Fonctionnel -> Physique), toutes les entités, leurs relations et les règles d'agrégation.

---

## 1. Architecture en trois couches

Sowel sépare les responsabilités en trois couches distinctes :

```
+-------------------------------------------------------------+
|  LAYER 1 -- TOPOLOGY (Zones)                                |
|  Spatial structure of the home                               |
|  Hierarchical: Home -> Floor -> Room                         |
|  Aggregates data automatically from child Equipments         |
+-------------------------------------------------------------+
|  LAYER 2 -- FUNCTIONAL (Equipments + Groups)                 |
|  What the user sees and controls                             |
|  Placed IN a Zone, optionally IN a Group                     |
|  Binds to one or more physical Devices                       |
+-------------------------------------------------------------+
|  LAYER 3 -- PHYSICAL (Devices)                               |
|  Hardware discovered from integrations                       |
|  Auto-discovered, raw data and commands                      |
|  Never directly manipulated by the end user                  |
+-------------------------------------------------------------+
```

**Principe directeur** : un Device est ce qui est sur le réseau. Un Equipment est ce qui est dans la pièce.

---

## 2. Diagramme entité-relation

```
Zone (hierarchy: parent -> children)
 |
 +-- EquipmentGroup (optional functional grouping)
 |    +-- Equipment*
 |
 +-- Equipment (functional unit, user-facing)
      +-- DataBinding --> DeviceData (on a Device)
      +-- OrderBinding --> DeviceOrder (on a Device)
      +-- [V0.5] ComputedData (expression-based virtual data)

Device (physical, auto-discovered)
 +-- DeviceData (readable properties: temperature, state, brightness...)
 +-- DeviceOrder (writable commands: set brightness, turn on...)
```

---

## 3. Zone

Une **Zone** représente une aire spatiale dans la maison. Les zones forment une **hiérarchie en arbre**.

### 3.1 Interface

```typescript
interface Zone {
  id: string; // UUID v4
  name: string; // "Cuisine", "Etage 1", "Maison"
  parentId: string | null; // null = root zone
  icon?: string; // Lucide icon name: "home", "sofa", "bed"
  description?: string; // "Piece principale, 35m2"
  displayOrder: number; // Sort order among siblings (0-based)
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
```

### 3.2 Hiérarchie

Les zones sont imbriquables sur n'importe quelle profondeur. Structure typique :

```
Maison                    (root, parentId: null)
+-- RDC                   (floor, parentId: Maison)
|   +-- Cuisine             (room, parentId: RDC)
|   +-- Cuisine           (room, parentId: RDC)
|   +-- Entree            (room, parentId: RDC)
|   +-- WC                (room, parentId: RDC)
+-- Etage                 (floor, parentId: Maison)
|   +-- Chambre Parentale (room, parentId: Etage)
|   +-- Chambre Enfant    (room, parentId: Etage)
|   +-- Salle de Bain     (room, parentId: Etage)
|   +-- Couloir           (room, parentId: Etage)
+-- Exterieur             (area, parentId: Maison)
    +-- Jardin            (area, parentId: Exterieur)
    +-- Garage            (area, parentId: Exterieur)
```

### 3.3 Données agrégées de zone

Le moteur **calcule automatiquement** les données agrégées de chaque Zone à partir des Equipments qu'elle contient. Aucune configuration manuelle requise, c'est une fonctionnalité centrale.

L'agrégation est **récursive** : une Zone parent agrège ses propres Equipments plus toutes les Zones enfants.

| Attribute                | Type           | Règle d'agrégation | Source (DataCategory) | Description                                                          |
| ------------------------ | -------------- | ------------------ | --------------------- | -------------------------------------------------------------------- |
| `temperature`            | number \| null | AVG                | `temperature`         | Température moyenne de la zone                                       |
| `humidity`               | number \| null | AVG                | `humidity`            | Humidité moyenne                                                     |
| `pressure`               | number \| null | AVG                | `pressure`            | Pression atmosphérique moyenne                                       |
| `luminosity`             | number \| null | AVG                | `luminosity`          | Luminosité moyenne (lux)                                             |
| `co2`                    | number \| null | AVG                | `co2`                 | Niveau de CO2 moyen (ppm)                                            |
| `voc`                    | number \| null | AVG                | `voc`                 | Niveau de COV moyen (ppb)                                            |
| `motion`                 | boolean        | OR                 | `motion`              | true si AU MOINS UN capteur de mouvement détecte du mouvement        |
| `presence`               | boolean        | OR + timeout       | `motion`              | true si du mouvement détecté dans un timeout configurable            |
| `openDoors`              | number         | COUNT (open)       | `contact_door`        | Nombre de contacts de porte ouverts                                  |
| `openWindows`            | number         | COUNT (open)       | `contact_window`      | Nombre de contacts de fenêtre ouverts                                |
| `waterLeak`              | boolean        | OR                 | `water_leak`          | true si AU MOINS UN capteur de fuite d'eau se déclenche              |
| `smoke`                  | boolean        | OR                 | `smoke`               | true si AU MOINS UN détecteur de fumée se déclenche                  |
| `lightsOn`               | number         | COUNT (on)         | `light_state`         | Nombre de lumières allumées                                          |
| `lightsTotal`            | number         | COUNT (all)        | `light_state`         | Nombre total d'équipements lumière                                   |
| `averageBrightness`      | number \| null | AVG (on only)      | `light_brightness`    | Luminosité moyenne des lumières allumées                             |
| `shuttersOpen`           | number         | COUNT (open)       | `shutter_position`    | Nombre de volets ouverts (type=shutter — exclut awning + pool_cover) |
| `shuttersTotal`          | number         | COUNT (all)        | `shutter_position`    | Nombre total de volets (type=shutter — exclut awning + pool_cover)   |
| `averageShutterPosition` | number \| null | AVG                | `shutter_position`    | Position moyenne des volets (%) — type=shutter uniquement            |
| `totalPower`             | number         | SUM                | `power`               | Puissance instantanée totale (W)                                     |
| `totalEnergy`            | number         | SUM                | `energy`              | Consommation d'énergie totale (kWh)                                  |
| `heatingActive`          | boolean        | OR                 | thermostat equipments | true si un thermostat chauffe activement                             |
| `targetTemperature`      | number \| null | AVG                | thermostat equipments | Consigne de température cible moyenne                                |

> **Note** : cette liste évoluera. De nouveaux attributs agrégés peuvent être ajoutés à mesure que de nouveaux types d'Equipment et DataCategories sont introduits.

### 3.4 Auto-ordres de zone

Les zones exposent des commandes en lot qui agissent sur tous les Equipments de la zone (et des zones enfants récursivement) :

| Order              | Effet                                              |
| ------------------ | -------------------------------------------------- |
| `allOff`           | Éteint TOUS les Equipments contrôlables de la Zone |
| `allLightsOff`     | Éteint tous les Equipments de type lumière         |
| `allLightsOn`      | Allume tous les Equipments de type lumière         |
| `allShuttersOpen`  | Ouvre tous les volets                              |
| `allShuttersClose` | Ferme tous les volets                              |

### 3.5 Schéma SQLite

```sql
CREATE TABLE zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES zones(id) ON DELETE SET NULL,
  icon TEXT,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 4. Equipment Group

Un **EquipmentGroup** est un regroupement fonctionnel d'Equipments au sein d'une Zone. Il permet de contrôler et de surveiller un sous-ensemble d'équipements ensemble.

### 4.1 Interface

```typescript
interface EquipmentGroup {
  id: string; // UUID v4
  name: string; // "Volets Sud", "Eclairage Ambiance"
  zoneId: string; // FK -> Zone (a group belongs to exactly one zone)
  icon?: string; // Lucide icon name
  description?: string;
  displayOrder: number; // Sort order within the zone
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
```

### 4.2 Objectif et exemples

```
Cuisine (Zone)
+-- Group "Volets Sud"
|   +-- Volet Baie Vitree          (Equipment: shutter)
|   +-- Volet Porte Fenetre        (Equipment: shutter)
+-- Group "Volets Nord"
|   +-- Volet Fenetre Nord         (Equipment: shutter)
+-- Group "Eclairage Ambiance"
|   +-- Spots Plafond              (Equipment: dimmer)
|   +-- Lampe Canape               (Equipment: dimmer)
+-- Detection Cuisine                (Equipment: motion_sensor, no group)
+-- Temperature Cuisine              (Equipment: sensor, no group)
```

**Comportements clés :**

- Un Equipment appartient à **au plus un** Group (optionnel, via `groupId`)
- Un Group appartient à exactement une Zone
- Les Groups ont leurs propres données agrégées (mêmes règles que les Zones, périmètre = membres du groupe)
- Les Groups peuvent recevoir des ordres en lot (par ex., "fermer tous les volets de Volets Sud")

### 4.3 Données agrégées de groupe

Les Groups calculent les données agrégées avec les **mêmes règles** que les Zones (section 3.3), mais limitées aux Equipments membres du groupe. Cela permet :

- "Position moyenne des volets de Volets Sud" vs "Position moyenne des volets de Volets Nord"
- "Nombre de lumières allumées dans Eclairage Ambiance" vs comptage à l'échelle de la zone

### 4.4 Schéma SQLite

```sql
CREATE TABLE equipment_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  icon TEXT,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 5. Equipment

Un **Equipment** est l'unité fonctionnelle visible par l'utilisateur. C'est l'entité primaire avec laquelle l'utilisateur interagit dans l'UI, les scénarios et les commandes vocales.

### 5.1 Interface

```typescript
type EquipmentType =
  | "light" // on/off light
  | "dimmer" // dimmable light
  | "color_light" // color-capable light
  | "shutter" // cover, blind, shutter
  | "awning" // store banne (frère du shutter, vocabulaire awning)
  | "thermostat" // heating/cooling control
  | "lock" // door lock
  | "alarm" // alarm system
  | "sensor" // generic sensor (temp, humidity...)
  | "motion_sensor" // motion detector
  | "contact_sensor" // door/window contact
  | "media_player" // media device
  | "camera" // surveillance camera
  | "switch" // on/off switch or plug
  | "water_valve" // smart irrigation valve (toggle + timed watering)
  | "generic"; // anything else

interface Equipment {
  id: string; // UUID v4
  name: string; // "Spots Cuisine", "Volet Baie Vitree"
  zoneId: string; // FK -> Zone (where the equipment functions)
  groupId: string | null; // FK -> EquipmentGroup (optional)
  type: EquipmentType; // Semantic type, drives UI rendering & aggregation
  icon?: string; // Lucide icon name (overrides type default)
  description?: string;
  enabled: boolean; // Disabled equipments are ignored by the engine
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
```

### 5.2 Equipment vs Device

|                      | Device                                 | Equipment                           |
| -------------------- | -------------------------------------- | ----------------------------------- |
| **Nature**           | Matériel physique                      | Abstraction fonctionnelle           |
| **Découverte**       | Auto-découvert depuis les intégrations | Créé manuellement par l'utilisateur |
| **Identité**         | ID spécifique à l'intégration          | Nom choisi par l'utilisateur        |
| **Localisation**     | Où il est installé physiquement        | Où il est utilisé fonctionnellement |
| **Cardinalité**      | 1 Device -> N Equipments possible      | 1 Equipment -> N Devices possible   |
| **Interaction user** | Jamais (couche technique)              | Toujours (interface principale)     |

**Exemples :**

- 1 Device -> 1 Equipment : capteur de température Aqara -> "Temperature Cuisine"
- 1 Device -> N Equipments : module double relais -> "Lumiere Cuisine" + "Lumiere Cellier"
- N Devices -> 1 Equipment : 3 capteurs PIR -> "Detection Cuisine" (via computed data, V0.5)

---

## 6. Data Binding

Un **DataBinding** mappe une propriété Device Data vers un alias au niveau Equipment.

### 6.1 Interface

```typescript
interface DataBinding {
  id: string; // UUID v4
  equipmentId: string; // FK -> Equipment
  deviceDataId: string; // FK -> DeviceData
  alias: string; // Equipment-level name: "state", "brightness", "temperature"
}
```

### 6.2 Comment ça marche

```
Device "Variateur #1"
+-- DeviceData: key="state", value="ON"        <--+
+-- DeviceData: key="brightness", value=180    <---+-- DataBinding
+-- DeviceData: key="linkquality", value=85        |
                                                   |
Equipment "Spots Cuisine"                            |
+-- Data alias "state" ----------------------------+ (bound to DeviceData "state")
+-- Data alias "brightness" -----------------------  (bound to DeviceData "brightness")
+-- [not bound to linkquality -- it's a technical metric, not user-facing]
```

### 6.3 Contraintes

- `UNIQUE(equipment_id, alias)`, chaque alias est unique par Equipment
- Quand le DeviceData change, l'alias lié de l'Equipment reflète la nouvelle valeur immédiatement
- L'alias est utilisé dans les expressions, l'affichage UI, l'agrégation de zone et les conditions de Scenario

### 6.4 Schéma SQLite

```sql
CREATE TABLE data_bindings (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  device_data_id TEXT NOT NULL REFERENCES device_data(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  UNIQUE(equipment_id, alias)
);
```

---

## 7. Order Binding

Un **OrderBinding** mappe un Device Order vers un alias de commande au niveau Equipment.

### 7.1 Interface

```typescript
interface OrderBinding {
  id: string; // UUID v4
  equipmentId: string; // FK -> Equipment
  deviceOrderId: string; // FK -> DeviceOrder
  alias: string; // Equipment-level command: "turn_on", "set_brightness"
}
```

### 7.2 Comment ça marche

Quand un Equipment Order est exécuté :

```
User clicks "Turn On" on Equipment "Spots Cuisine"
  -> API: POST /equipments/:id/orders/turn_on { value: true }
    -> Equipment Manager finds OrderBinding alias="turn_on"
      -> Resolves to DeviceOrder
        -> Integration Plugin dispatches command to device
```

### 7.3 Dispatch multi-devices

Un Equipment peut avoir plusieurs OrderBindings avec **le même alias** pointant vers des Devices différents. Cela permet de contrôler plusieurs devices avec une seule commande :

```
Equipment "Eclairage Cuisine"
+-- OrderBinding: alias="turn_on" -> DeviceOrder on Relais #1
+-- OrderBinding: alias="turn_on" -> DeviceOrder on Relais #2
```

L'exécution de `turn_on` dispatche vers les DEUX relais en parallèle.

**Note sur la contrainte du schéma :** pour le dispatch multi-devices, la contrainte UNIQUE est sur `(equipment_id, alias, device_order_id)`, pas seulement `(equipment_id, alias)`.

### 7.4 Schéma SQLite

```sql
CREATE TABLE order_bindings (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  device_order_id TEXT NOT NULL REFERENCES device_orders(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  UNIQUE(equipment_id, alias, device_order_id)
);
```

---

## 8. Device (Couche 3, physique)

Les Devices sont auto-découverts depuis les intégrations configurées (Zigbee2MQTT, Panasonic CC, MCZ Maestro, Netatmo HC, etc.). Ils sont documentés ici par souci de complétude.

### 8.1 Interface

```typescript
interface Device {
  id: string; // UUID v4
  mqttBaseTopic: string; // Integration-specific topic or identifier
  mqttName: string; // Integration-specific name or ID
  name: string; // User-editable display name
  manufacturer?: string; // "Aqara", "IKEA", "Panasonic", "MCZ"
  model?: string; // "MCCGQ11LM", "CS-Z25VKEW", etc.
  ieeeAddress?: string; // Hardware address (Zigbee IEEE, serial, etc.)
  source: DeviceSource; // "zigbee2mqtt" | "panasonic_cc" | "mcz_maestro" | "netatmo_hc" | ...
  status: DeviceStatus; // "online" | "offline" | "unknown"
  lastSeen: string | null; // ISO 8601
  rawExpose?: unknown; // Raw integration-specific metadata
  createdAt: string;
  updatedAt: string;
}
```

### 8.2 DeviceData

```typescript
interface DeviceData {
  id: string;
  deviceId: string; // FK -> Device
  key: string; // Property name: "temperature", "state", "brightness"
  type: DataType; // "boolean" | "number" | "enum" | "text" | "json"
  category: DataCategory; // Semantic category for aggregation rules
  value: unknown; // Current value
  unit?: string; // "C", "%", "lx", "W"
  lastUpdated: string | null;
}
```

### 8.3 DeviceOrder

```typescript
interface DeviceOrder {
  id: string;
  deviceId: string; // FK -> Device
  key: string; // "state", "brightness", "position"
  type: DataType;
  mqttSetTopic: string; // MQTT topic to publish to
  payloadKey: string; // Key in the JSON payload
  min?: number; // For numeric: minimum value
  max?: number; // For numeric: maximum value
  enumValues?: string[]; // For enum: allowed values
  unit?: string;
}
```

---

## 9. Computed Data (V0.5)

> **Différé en V0.5**, documenté ici dans le cadre du modèle de données complet.

Une **ComputedData** est un point de donnée virtuel sur un Equipment dont la valeur est dérivée d'une expression sur d'autres sources de données.

### 9.1 Interface

```typescript
interface ComputedData {
  id: string; // UUID v4
  equipmentId: string; // FK -> Equipment
  key: string; // "state", "average_temperature", "motion"
  type: DataType;
  category: DataCategory; // Used by Zone aggregation
  expression: string; // Computation expression
  value: unknown; // Current computed value
}
```

### 9.2 Langage d'expression

```
// Boolean
OR(binding.motion_1, binding.motion_2)
AND(binding.door, binding.window)
NOT(binding.occupancy)

// Numeric
AVG(binding.temp_1, binding.temp_2)
MIN(binding.temp_1, binding.temp_2)
MAX(binding.temp_1, binding.temp_2)
SUM(binding.power_1, binding.power_2)

// Conditional
IF(binding.brightness > 0, "on", "off")
THRESHOLD(binding.temperature, 19, "cold", "ok")

// References
binding.<alias>                        -> DataBinding on the same Equipment
equipment.<equipmentId>.<alias>        -> Data on another Equipment
zone.<zoneId>.<key>                    -> Zone aggregated Data
```

---

## 10. Flux de données réactif

Le pipeline complet piloté par les événements :

```
Integration event (MQTT message, cloud API poll, etc.)
  |
  v
Integration Plugin (receives + parses)
  |
  v
Device Manager (updates DeviceData)
  |
  +--> Event: "device.data.updated"
  |
  v
Equipment Manager
  +-- Updates bound Equipment Data (via DataBindings)
  +-- [V0.5] Re-evaluates ComputedData expressions
  |
  +--> Event: "equipment.data.changed"
  |
  v
Zone Aggregator
  +-- Re-computes Zone aggregated data
  +-- Re-computes Group aggregated data
  +-- Propagates up the zone hierarchy (recursive)
  |
  +--> Event: "zone.data.changed"
  |
  v
Scenario Engine (V0.7)
  +-- Evaluates triggers
  +-- Checks conditions
  +-- Executes actions
  |
  +--> Actions may dispatch Equipment/Zone Orders -> Integration Plugin -> device
  |
  v
WebSocket Server
  +-- Broadcasts all events to connected UI clients
```

---

## 11. Événements de l'Event Bus

Tous les événements sont typés via les unions discriminées TypeScript.

### Événements système

| Event                      | Payload         | Quand                    |
| -------------------------- | --------------- | ------------------------ |
| `system.started`           | --              | Démarrage moteur terminé |
| `system.mqtt.connected`    | --              | Broker MQTT connecté     |
| `system.mqtt.disconnected` | --              | Broker MQTT perdu        |
| `system.error`             | `error: string` | Erreur non récupérable   |

### Événements Device (V0.1)

| Event                   | Payload                                              | Quand                   |
| ----------------------- | ---------------------------------------------------- | ----------------------- |
| `device.discovered`     | `device: Device`                                     | Nouveau device trouvé   |
| `device.removed`        | `deviceId, deviceName`                               | Device supprimé         |
| `device.status_changed` | `deviceId, deviceName, status`                       | Online/offline          |
| `device.data.updated`   | `deviceId, deviceName, dataId, key, value, previous` | Changement de propriété |

### Événements Equipment (V0.3)

| Event                      | Payload                             | Quand                |
| -------------------------- | ----------------------------------- | -------------------- |
| `equipment.data.changed`   | `equipmentId, key, value, previous` | Donnée liée modifiée |
| `equipment.order.executed` | `equipmentId, orderAlias, value`    | Ordre dispatché      |

### Événements Zone (V0.3+)

| Event               | Payload                        | Quand                   |
| ------------------- | ------------------------------ | ----------------------- |
| `zone.data.changed` | `zoneId, key, value, previous` | Donnée agrégée modifiée |

---

## 12. Schéma SQLite complet

```sql
-- ============================================================
-- ZONES (V0.2)
-- ============================================================
CREATE TABLE zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES zones(id) ON DELETE SET NULL,
  icon TEXT,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- EQUIPMENT GROUPS (V0.2)
-- ============================================================
CREATE TABLE equipment_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  icon TEXT,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- DEVICES (V0.1 -- existing)
-- ============================================================
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  mqtt_base_topic TEXT NOT NULL UNIQUE,
  mqtt_name TEXT NOT NULL,
  name TEXT NOT NULL,
  manufacturer TEXT,
  model TEXT,
  ieee_address TEXT,
  source TEXT NOT NULL,  -- integration source: 'zigbee2mqtt', 'panasonic_cc', 'mcz_maestro', 'netatmo_hc', ...
  status TEXT NOT NULL DEFAULT 'unknown',
  last_seen DATETIME,
  raw_expose JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE device_data (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'generic',
  value TEXT,
  unit TEXT,
  last_updated DATETIME,
  UNIQUE(device_id, key)
);

CREATE TABLE device_orders (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  type TEXT NOT NULL,
  mqtt_set_topic TEXT NOT NULL,
  payload_key TEXT NOT NULL,
  min_value REAL,
  max_value REAL,
  enum_values JSON,
  unit TEXT,
  UNIQUE(device_id, key)
);

-- ============================================================
-- EQUIPMENTS (V0.3)
-- ============================================================
CREATE TABLE equipments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES equipment_groups(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'generic',
  icon TEXT,
  description TEXT,
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE data_bindings (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  device_data_id TEXT NOT NULL REFERENCES device_data(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  UNIQUE(equipment_id, alias)
);

CREATE TABLE order_bindings (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  device_order_id TEXT NOT NULL REFERENCES device_orders(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  UNIQUE(equipment_id, alias, device_order_id)
);

-- ============================================================
-- COMPUTED DATA (V0.5)
-- ============================================================
CREATE TABLE computed_data (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'generic',
  expression TEXT NOT NULL,
  value TEXT,
  UNIQUE(equipment_id, key)
);

-- ============================================================
-- INTERNAL RULES (V0.5)
-- ============================================================
CREATE TABLE internal_rules (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  condition_expr TEXT NOT NULL,
  action_expr TEXT NOT NULL,
  enabled INTEGER DEFAULT 1
);

-- ============================================================
-- RECIPES (V0.8)
-- ============================================================
CREATE TABLE recipe_instances (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  params JSON NOT NULL DEFAULT '{}',
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE recipe_state (
  instance_id TEXT NOT NULL REFERENCES recipe_instances(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (instance_id, key)
);

CREATE TABLE recipe_log (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES recipe_instances(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  data JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- USERS & AUTH
-- ============================================================
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'standard',
  preferences JSON DEFAULT '{}',
  enabled INTEGER DEFAULT 1,
  last_login_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  last_used_at DATETIME,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- SETTINGS (key-value store for integration config)
-- ============================================================
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 13. Récapitulatif des endpoints API

### Zones (V0.2)

| Method | Route               | Description                                          |
| ------ | ------------------- | ---------------------------------------------------- |
| GET    | `/api/v1/zones`     | Liste toutes les zones (structure arborescente)      |
| GET    | `/api/v1/zones/:id` | Récupère une zone avec données agrégées              |
| POST   | `/api/v1/zones`     | Crée une zone                                        |
| PUT    | `/api/v1/zones/:id` | Met à jour une zone                                  |
| DELETE | `/api/v1/zones/:id` | Supprime une zone (sans enfants ni équipements liés) |

### Equipment Groups (V0.2)

| Method | Route                          | Description                  |
| ------ | ------------------------------ | ---------------------------- |
| GET    | `/api/v1/zones/:zoneId/groups` | Liste les groupes d'une zone |
| POST   | `/api/v1/zones/:zoneId/groups` | Crée un groupe dans une zone |
| PUT    | `/api/v1/groups/:id`           | Met à jour un groupe         |
| DELETE | `/api/v1/groups/:id`           | Supprime un groupe           |

### Equipments (V0.3)

| Method | Route                                  | Description                                               |
| ------ | -------------------------------------- | --------------------------------------------------------- |
| GET    | `/api/v1/equipments`                   | Liste tous les équipements                                |
| GET    | `/api/v1/equipments/:id`               | Récupère un équipement avec liaisons et données courantes |
| POST   | `/api/v1/equipments`                   | Crée un équipement                                        |
| PUT    | `/api/v1/equipments/:id`               | Met à jour un équipement                                  |
| DELETE | `/api/v1/equipments/:id`               | Supprime un équipement                                    |
| POST   | `/api/v1/equipments/:id/orders/:alias` | Exécute un ordre d'équipement                             |

### Zone Orders (V0.3+)

| Method | Route                                 | Description                                               |
| ------ | ------------------------------------- | --------------------------------------------------------- |
| POST   | `/api/v1/zones/:id/orders/:orderKey`  | Exécute un auto-ordre de zone (allOff, allLightsOff, ...) |
| POST   | `/api/v1/groups/:id/orders/:orderKey` | Exécute un ordre de groupe                                |

Pour la référence complète de l'API, voir [Référence API](api-reference.md).

---

## 14. Roadmap d'implémentation

| Version   | Entités implémentées                                                  |
| --------- | --------------------------------------------------------------------- |
| **V0.1**  | Device, DeviceData, DeviceOrder                                       |
| **V0.2**  | Zone, EquipmentGroup (CRUD + UI)                                      |
| **V0.3**  | Equipment, DataBinding, OrderBinding (CRUD + exécution d'ordres + UI) |
| **V0.5**  | ComputedData, InternalRule                                            |
| **V0.3+** | Moteur d'agrégation de zone, auto-ordres de zone                      |
