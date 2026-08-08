# Guide de développement de plugins Sowel

Ce guide explique comment créer un plugin tiers pour Sowel. Un plugin est une intégration autonome qui peut être installée, activée, désactivée et supprimée au runtime sans redémarrer le moteur Sowel.

Le plugin `sowel-plugin-weather-forecast` est utilisé comme exemple de référence tout au long de ce document.

---

## Sommaire

1. [Vue d'ensemble](#vue-densemble)
2. [Structure d'un plugin](#structure-dun-plugin)
3. [Schéma du manifest](#schema-du-manifest)
4. [Référence de l'API PluginDeps](#reference-de-lapi-plugindeps)
5. [Interface IntegrationPlugin](#interface-integrationplugin)
6. [Créer un plugin pas à pas](#creer-un-plugin-pas-a-pas)
7. [Découverte de devices](#decouverte-de-devices)
8. [Mises à jour de données device](#mises-a-jour-de-donnees-device)
9. [Exécution d'ordres](#execution-dordres)
10. [Réglages](#reglages)
11. [Publication et versioning](#publication-et-versioning)
12. [Dépannage](#depannage)

---

## Vue d'ensemble

Un plugin Sowel est un package Node.js ESM (ECMAScript Module) qui exporte une fonction usine `createPlugin`. Au chargement, Sowel injecte un objet `PluginDeps` qui donne accès aux services centraux (logs, event bus, gestion des devices, settings). Le plugin utilise ces dépendances pour découvrir des devices, pousser des mises à jour de données, et traiter des ordres, exactement comme les intégrations historiques.

Les plugins vivent dans le répertoire `plugins/` à la racine de Sowel. Chaque plugin a son propre sous-répertoire qui contient un `manifest.json` et le JavaScript compilé dans `dist/`.

**Cycle de vie :**

1. Sowel lit la table `plugins` de la base au démarrage
2. Pour chaque plugin activé, Sowel importe dynamiquement `plugins/<id>/dist/index.js` (ESM)
3. La fonction usine `createPlugin` exportée reçoit `PluginDeps` et retourne une instance d'`IntegrationPlugin`
4. Sowel enregistre le plugin auprès de l'`IntegrationRegistry`
5. Si le plugin est configuré (`isConfigured()` renvoie true), Sowel appelle `plugin.start()`
6. À la désactivation/désinstallation, Sowel appelle `plugin.stop()` et le retire du registre

---

## Structure d'un plugin

```
sowel-plugin-my-device/
  manifest.json          # Plugin metadata (required)
  package.json           # Node.js package descriptor ("type": "module")
  tsconfig.json          # TypeScript config (module: "NodeNext")
  dist/
    index.js             # Compiled entry point (ESM)
    index.js.map         # Source map (optional)
  src/
    index.ts             # TypeScript source (not loaded by Sowel)
```

**Règles clés :**

- Le point d'entrée est toujours `dist/index.js`, c'est codé en dur dans le plugin loader
- Utilisez le **format ESM** (`export { createPlugin }`), Sowel utilise un `import()` dynamique pour charger les plugins
- Définissez `"type": "module"` dans `package.json`
- Définissez `"module": "NodeNext"` et `"moduleResolution": "NodeNext"` dans `tsconfig.json`
- Le répertoire `src/` est pour le développement uniquement, Sowel ne le lit jamais
- Les `node_modules/` propres au plugin sont isolés des dépendances de Sowel

---

## Schéma du manifest

Le fichier `manifest.json` décrit le plugin à Sowel. Il vit à la racine du répertoire du plugin.

**Exemple** (depuis `sowel-plugin-weather-forecast`) :

```json
{
  "id": "weather-forecast",
  "name": "Weather Forecast",
  "version": "0.2.0",
  "description": "Weather forecast via Open-Meteo API (free, no API key)",
  "icon": "CloudSun",
  "author": "mchacher",
  "sowelVersion": ">=0.10.0",
  "settings": [
    {
      "key": "polling_interval",
      "label": "Polling interval (minutes)",
      "type": "number",
      "required": false,
      "defaultValue": "30",
      "placeholder": "Min 15, default 30"
    }
  ]
}
```

### Référence des champs

| Champ          | Type                    | Requis | Description                                                                                                                                |
| -------------- | ----------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`           | string                  | Oui    | Identifiant unique du plugin. Minuscules avec tirets (par ex. `weather-forecast`). Doit correspondre au nom du répertoire sous `plugins/`. |
| `name`         | string                  | Oui    | Nom d'affichage lisible présenté dans l'UI.                                                                                                |
| `version`      | string                  | Oui    | Version SemVer (par ex. `0.2.0`). **Doit être mise à jour à chaque release.** Voir [Versioning](#versioning).                              |
| `description`  | string                  | Oui    | Courte description (une phrase) affichée dans le store de plugins et la page intégrations.                                                 |
| `icon`         | string                  | Oui    | Nom d'icône Lucide (par ex. `CloudSun`, `Camera`). Utilisé dans l'UI pour la carte d'intégration.                                          |
| `author`       | string                  | Non    | Nom de l'auteur ou organisation.                                                                                                           |
| `sowelVersion` | string                  | Non    | Plage SemVer des versions Sowel compatibles (par ex. `>=0.10.0`).                                                                          |
| `settings`     | IntegrationSettingDef[] | Non    | Tableau de définitions de réglages pour le formulaire de configuration UI. Voir [Réglages](#reglages).                                     |

**Champs qui n'existent PAS dans le manifest :** `entry`, `integrationId`, `license`, `repository`. Ne les incluez pas.

---

## Référence de l'API PluginDeps

Quand Sowel charge un plugin, il passe un objet `PluginDeps` à la fonction usine `createPlugin`. C'est la porte d'entrée du plugin vers tous les services centraux Sowel.

```typescript
interface PluginDeps {
  logger: Logger;
  eventBus: EventBus;
  settingsManager: SettingsManager;
  deviceManager: DeviceManager;
  pluginDir: string;
}
```

### `logger`

Un child logger pino préconfiguré avec `{ module: "plugin:<pluginId>" }`. Utilisez-le pour tous les logs, n'utilisez jamais `console.log`.

```typescript
deps.logger.info({ deviceCount: 5 }, "Devices discovered");
deps.logger.debug({ response }, "API response received");
deps.logger.error({ err }, "Poll failed");
```

**Conseils par niveau :**

| Niveau  | Usage                                                                 |
| ------- | --------------------------------------------------------------------- |
| `info`  | Événements significatifs : connecté, devices découverts, poll terminé |
| `debug` | Détails opérationnels : réponses d'API, étapes intermédiaires         |
| `trace` | Données à haut volume : chaque message, chaque point de données       |
| `error` | Opération échouée, incluez toujours `{ err }` avec l'objet Error      |
| `warn`  | Inattendu mais géré : retry, fallback, récupérable                    |

### `eventBus`

L'event emitter typé. Les plugins émettent typiquement des événements de cycle de vie d'intégration :

```typescript
deps.eventBus.emit({ type: "system.integration.connected", integrationId: "my-plugin" });
deps.eventBus.emit({ type: "system.integration.disconnected", integrationId: "my-plugin" });
```

### `settingsManager`

Lit et écrit les réglages stockés dans la table SQLite `settings`. Les réglages utilisent une **clé complète** avec le préfixe `integration.<pluginId>.`.

```typescript
// Read a setting -- returns string | undefined
const interval = deps.settingsManager.get("integration.weather-forecast.polling_interval");

// Read a global Sowel setting (no prefix)
const lat = deps.settingsManager.get("home.latitude");

// Write a setting
deps.settingsManager.set("integration.weather-forecast.last_poll", Date.now().toString());
```

**Important :** `get()` prend la **clé complète** (par ex. `integration.weather-forecast.polling_interval`) et retourne `string | undefined` (pas null). Les réglages déclarés dans le tableau `settings` de votre manifest sont automatiquement namespacés par Sowel sous `integration.<pluginId>.<key>`.

**Méthodes :**

| Méthode       | Signature                                    | Description                                       |
| ------------- | -------------------------------------------- | ------------------------------------------------- |
| `get`         | `(key: string) => string \| undefined`       | Récupère un réglage par sa clé complète           |
| `set`         | `(key: string, value: string) => void`       | Définit un réglage                                |
| `getByPrefix` | `(prefix: string) => Record<string, string>` | Récupère tous les réglages commençant par préfixe |
| `setMany`     | `(entries: Record<string, string>) => void`  | Définit plusieurs réglages d'un coup              |

### `deviceManager`

Gère les devices découverts par votre plugin. Deux méthodes principales sont utilisées :

| Méthode               | Signature                                                                                   | Description                                           |
| --------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `upsertFromDiscovery` | `(integrationId: string, source: string, discovered: DiscoveredDevice) => void`             | Crée ou met à jour un device depuis la découverte     |
| `updateDeviceData`    | `(integrationId: string, sourceDeviceId: string, payload: Record<string, unknown>) => void` | Pousse de nouvelles valeurs de données pour un device |

Voir [Découverte de devices](#decouverte-de-devices) et [Mises à jour de données device](#mises-a-jour-de-donnees-device) pour l'usage détaillé.

### `pluginDir`

Chemin absolu vers le répertoire installé du plugin (par ex. `/app/plugins/weather-forecast`). Utilisez-le pour lire des fichiers locaux ou stocker des données spécifiques au plugin.

```typescript
import { resolve } from "node:path";
const cachePath = resolve(deps.pluginDir, "cache.json");
```

**Note :** il n'y a pas de `mqttConnector` dans `PluginDeps`. Si votre plugin a besoin de MQTT, utilisez le package npm `mqtt` directement comme dépendance du plugin.

---

## Scoping des plugins (spec 111)

Depuis Sowel v1.11.0, les trois services mutables de votre `PluginDeps` sont enveloppés sans condition dans des Proxies scopés. La forme et les signatures de `PluginDeps` sont bit-pour-bit identiques, donc **vous n'avez pas à modifier votre code de plugin**, mais le runtime applique quatre invariants :

### 1. Les settings sont scopés à votre plugin

```ts
// ✅ Autorisé — votre propre préfixe d'intégration
const refreshToken = deps.settingsManager.get(`integration.${INTEGRATION_ID}.refresh_token`);
deps.settingsManager.set(`integration.${INTEGRATION_ID}.refresh_token`, "new-value");

// ✅ Autorisé — clés globales explicites (position du foyer, fuseau)
const lat = deps.settingsManager.get("home.latitude");

// ❌ Renvoie undefined + log warn — vous ne pouvez pas lire les settings d'un autre plugin
const stolen = deps.settingsManager.get("integration.another-plugin.refresh_token");

// ❌ Throw — vous ne pouvez pas écrire sur une clé qui ne vous appartient pas
deps.settingsManager.set("integration.another-plugin.x", "evil");

// ❌ Renvoie vide — les lectures larges sont refusées
deps.settingsManager.getAll();
deps.settingsManager.getByPrefix("integration.");
```

Si votre plugin a besoin de lire légitimement un autre setting global, demandez son ajout à `GLOBAL_READABLE_KEYS` dans `src/plugins/scoped-deps.ts` via une PR sur le repo Sowel core.

### 2. Les events sont limités à une petite whitelist

Vous ne pouvez émettre que ces types :

- `system.integration.connected` / `system.integration.disconnected`
- `system.alarm.raised` / `system.alarm.resolved`

Tout autre type est silencieusement abandonné avec un log warn. Les events de domaine (`device.data.updated`, `equipment.data.changed`, etc.) sont émis par les managers de Sowel en réaction à vos appels (`deviceManager.updateDeviceData`, etc.) ; vous ne devriez jamais avoir à les émettre directement.

De plus, si vous mettez `integrationId` sur un event `system.integration.*`, il doit matcher votre propre id de plugin. L'usurpation est refusée.

### 3. Les mutations devices sont forcées à votre ownership

```ts
// ✅ Autorisé — votre propre integration id
deps.deviceManager.updateDeviceData(INTEGRATION_ID, sourceDeviceId, { state: "on" });
deps.deviceManager.upsertFromDiscovery(INTEGRATION_ID, "zigbee2mqtt", discovered);

// ❌ Throw — vous ne pouvez pas toucher aux devices d'une autre intégration
deps.deviceManager.updateDeviceData("another-plugin", "x", { state: "on" });
deps.deviceManager.migrateIntegrationId("old-id", "another-plugin");

// ❌ Throw — les actions admin ne sont pas disponibles aux plugins
deps.deviceManager.update(deviceId, { name: "renamed" });
deps.deviceManager.delete(deviceId);
```

Les méthodes de lecture (`getAll`, `getById`, `getDeviceData`, `getDeviceDataValue`, `logSummary`) passent inchangées ; lire les devices d'une autre intégration est autorisé (rare mais légitime, par exemple un plugin pool qui lit un équipement météo).

### 4. Les erreurs des méthodes lifecycle sont confinées

Un throw dans `refresh()`, `getStatus()`, `isConfigured()`, `getSettingsSchema()`, `getPollingInfo()`, `getOAuthUrl()` est **loggé avec l'id de votre plugin** et remplacé par une valeur par défaut sûre (`undefined`, `"error"`, `false`, `[]`, `null`). Le core Sowel continue à tourner.

Un throw dans `start()`, `stop()`, `executeOrder()` ou `handleOAuthCallback()` est toujours loggé mais **rethrown** parce que l'appelant (registry, moteur de recettes, route OAuth) doit pouvoir réagir.

Vous êtes libre de throw dans n'importe quelle méthode lifecycle sans craindre de faire tomber Sowel.

### Ce contre quoi le Proxy ne protège pas

Pour transparence totale, l'isolation soft ne bloque pas :

- L'import direct de `better-sqlite3` et la lecture de `data/sowel.db`
- La lecture de `process.env`
- Les boucles infinies ou fuites mémoire
- La pollution de prototype (`Object.prototype.X = ...`)
- Les appels `fetch()` ou réseau sortants arbitraires
- `process.exit()`

Ces protections nécessiteraient une hard isolation via worker threads (une future spec Sowel). Pour l'instant, les auteurs de plugins doivent suivre l'esprit du contrat : n'accéder qu'à vos propres settings, n'émettre que vos propres events, ne muter que vos propres devices.

---

## Interface IntegrationPlugin

La fonction usine `createPlugin` doit retourner un objet qui implémente l'interface `IntegrationPlugin` :

```typescript
interface IntegrationPlugin {
  readonly id: string; // Unique integration ID (must match manifest.id)
  readonly name: string; // Human-readable name
  readonly description: string; // Short description for the UI
  readonly icon: string; // Lucide icon name

  getStatus(): IntegrationStatus;
  isConfigured(): boolean;
  getSettingsSchema(): IntegrationSettingDef[];
  start(options?: { pollOffset?: number }): Promise<void>;
  stop(): Promise<void>;
  executeOrder(
    device: Device,
    dispatchConfig: Record<string, unknown>,
    value: unknown,
  ): Promise<void>;
  refresh?(): Promise<void>;
  getPollingInfo?(): { lastPollAt: string; intervalMs: number } | null;
}

type IntegrationStatus = "connected" | "disconnected" | "not_configured" | "error";
```

### Référence des méthodes

| Méthode               | Requise | Description                                                                                                        |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `getStatus()`         | Oui     | Retourne le statut de connexion courant. Retournez `"not_configured"` si `isConfigured()` est false.               |
| `isConfigured()`      | Oui     | Retourne true si tous les réglages requis sont présents. Sowel n'appelle `start()` que si c'est true.              |
| `getSettingsSchema()` | Oui     | Retourne la définition du formulaire de réglages (identique au champ `settings` du manifest).                      |
| `start(options?)`     | Oui     | Démarre l'intégration. `pollOffset` est fourni par Sowel pour étaler plusieurs plugins en polling.                 |
| `stop()`              | Oui     | Arrêt propre : annule les timers, ferme les connexions.                                                            |
| `executeOrder()`      | Oui     | Exécute une commande sur un device. Levez une erreur si le plugin ne supporte pas les ordres.                      |
| `refresh()`           | Non     | Force un rafraîchissement immédiat (par ex. re-poll de l'API cloud). Appelé depuis le bouton refresh de l'UI.      |
| `getPollingInfo()`    | Non     | Retourne le timestamp du dernier poll et l'intervalle. Affiché dans l'UI intégrations pour les plugins en polling. |

---

## Créer un plugin pas à pas

### 1. Initialiser le projet

```bash
mkdir sowel-plugin-my-device
cd sowel-plugin-my-device
npm init -y
npm install -D typescript
```

Modifiez `package.json`, définissez `"type": "module"` :

```json
{
  "name": "sowel-plugin-my-device",
  "version": "0.1.0",
  "description": "Sowel plugin: My Device integration",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  }
}
```

### 2. Configurer TypeScript

Créez `tsconfig.json`, utilisez le format module `NodeNext` :

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

### 3. Définir les interfaces de types locales

Les plugins **n'importent pas** depuis le code source de Sowel. À la place, définissez des interfaces locales qui correspondent à la forme de `PluginDeps`. Cela maintient le plugin entièrement découplé.

```typescript
// src/index.ts -- local type definitions

interface Logger {
  child(bindings: Record<string, unknown>): Logger;
  info(obj: Record<string, unknown>, msg: string): void;
  info(msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  warn(msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
  error(msg: string): void;
  debug(obj: Record<string, unknown>, msg: string): void;
  debug(msg: string): void;
}

interface EventBus {
  emit(event: unknown): void;
}

interface SettingsManager {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

interface DiscoveredDevice {
  ieeeAddress?: string;
  friendlyName: string;
  manufacturer?: string;
  model?: string;
  data: {
    key: string;
    type: string;
    category: string;
    unit?: string;
  }[];
  orders: {
    key: string;
    type: string;
    dispatchConfig: Record<string, unknown>;
    min?: number;
    max?: number;
    enumValues?: string[];
    unit?: string;
  }[];
}

interface DeviceManager {
  upsertFromDiscovery(integrationId: string, source: string, discovered: DiscoveredDevice): void;
  updateDeviceData(
    integrationId: string,
    sourceDeviceId: string,
    payload: Record<string, unknown>,
  ): void;
}

interface Device {
  id: string;
  integrationId: string;
  sourceDeviceId: string;
  name: string;
  manufacturer?: string;
  model?: string;
}

interface PluginDeps {
  logger: Logger;
  eventBus: EventBus;
  settingsManager: SettingsManager;
  deviceManager: DeviceManager;
  pluginDir: string;
}

type IntegrationStatus = "connected" | "disconnected" | "not_configured" | "error";

interface IntegrationSettingDef {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "boolean";
  required: boolean;
  placeholder?: string;
  defaultValue?: string;
}

interface IntegrationPlugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  getStatus(): IntegrationStatus;
  isConfigured(): boolean;
  getSettingsSchema(): IntegrationSettingDef[];
  start(options?: { pollOffset?: number }): Promise<void>;
  stop(): Promise<void>;
  executeOrder(
    device: Device,
    dispatchConfig: Record<string, unknown>,
    value: unknown,
  ): Promise<void>;
  refresh?(): Promise<void>;
  getPollingInfo?(): { lastPollAt: string; intervalMs: number } | null;
}
```

### 4. Implémenter le plugin

Sous les définitions de types, implémentez votre classe de plugin et exportez l'usine :

```typescript
const PLUGIN_ID = "my-device";
const SETTINGS_PREFIX = `integration.${PLUGIN_ID}.`;
const SOURCE_DEVICE_ID = "My Device"; // Must match friendlyName in DiscoveredDevice

class MyDevicePlugin implements IntegrationPlugin {
  readonly id = PLUGIN_ID;
  readonly name = "My Device";
  readonly description = "Integration with My Device API";
  readonly icon = "Cpu";

  private logger: Logger;
  private settingsManager: SettingsManager;
  private deviceManager: DeviceManager;
  private eventBus: EventBus;

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPollAt: string | null = null;
  private pollIntervalMs = 300_000;
  private status: IntegrationStatus = "disconnected";

  constructor(deps: PluginDeps) {
    this.logger = deps.logger.child({ module: PLUGIN_ID });
    this.settingsManager = deps.settingsManager;
    this.deviceManager = deps.deviceManager;
    this.eventBus = deps.eventBus;
  }

  getStatus(): IntegrationStatus {
    if (!this.isConfigured()) return "not_configured";
    return this.status;
  }

  isConfigured(): boolean {
    return !!this.settingsManager.get(`${SETTINGS_PREFIX}api_url`);
  }

  getSettingsSchema(): IntegrationSettingDef[] {
    return [
      {
        key: "api_url",
        label: "API URL",
        type: "text",
        required: true,
        placeholder: "http://192.168.1.50/api",
      },
      {
        key: "polling_interval",
        label: "Polling interval (seconds)",
        type: "number",
        required: false,
        defaultValue: "300",
      },
    ];
  }

  getPollingInfo(): { lastPollAt: string; intervalMs: number } | null {
    return { lastPollAt: this.lastPollAt ?? "", intervalMs: this.pollIntervalMs };
  }

  async start(options?: { pollOffset?: number }): Promise<void> {
    if (!this.isConfigured()) {
      this.status = "not_configured";
      return;
    }

    // Read polling interval from settings
    const rawInterval = parseInt(
      this.settingsManager.get(`${SETTINGS_PREFIX}polling_interval`) ?? "300",
      10,
    );
    this.pollIntervalMs = Math.max(60_000, (isNaN(rawInterval) ? 300 : rawInterval) * 1000);

    await this.poll();
    this.schedulePoll(options?.pollOffset ?? 0);

    this.status = "connected";
    this.eventBus.emit({ type: "system.integration.connected", integrationId: this.id });
    this.logger.info({ pollIntervalMs: this.pollIntervalMs }, "Plugin started");
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.status = "disconnected";
    this.eventBus.emit({ type: "system.integration.disconnected", integrationId: this.id });
    this.logger.info("Plugin stopped");
  }

  async executeOrder(
    _device: Device,
    _dispatchConfig: Record<string, unknown>,
    _value: unknown,
  ): Promise<void> {
    throw new Error("My Device plugin does not support orders");
  }

  async refresh(): Promise<void> {
    await this.poll();
  }

  // --- Polling ---

  private async poll(): Promise<void> {
    try {
      // 1. Fetch data from your API
      // const data = await this.fetchData();

      // 2. Upsert device definition
      this.deviceManager.upsertFromDiscovery(PLUGIN_ID, PLUGIN_ID, {
        friendlyName: SOURCE_DEVICE_ID,
        manufacturer: "My Company",
        model: "Sensor v2",
        data: [
          { key: "temperature", type: "number", category: "temperature", unit: "C" },
          { key: "humidity", type: "number", category: "humidity", unit: "%" },
        ],
        orders: [],
      });

      // 3. Update device data values
      this.deviceManager.updateDeviceData(PLUGIN_ID, SOURCE_DEVICE_ID, {
        temperature: 21.5,
        humidity: 45,
      });

      this.lastPollAt = new Date().toISOString();
      this.logger.info("Poll complete");
    } catch (err) {
      this.logger.error({ err }, "Poll failed");
      throw err;
    }
  }

  private schedulePoll(offsetMs: number): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    const delay = offsetMs > 0 ? offsetMs : this.pollIntervalMs;
    this.pollTimer = setTimeout(async () => {
      try {
        await this.poll();
      } catch {
        /* already logged */
      }
      this.schedulePoll(0);
    }, delay);
  }
}

// ============================================================
// Plugin factory -- this is the entry point Sowel calls
// ============================================================

export function createPlugin(deps: PluginDeps): IntegrationPlugin {
  return new MyDevicePlugin(deps);
}
```

### 5. Build

```bash
npx tsc
```

Cela produit `dist/index.js` (ESM) prêt à être chargé par Sowel.

### 6. Créer le manifest

Créez `manifest.json` à la racine du plugin :

```json
{
  "id": "my-device",
  "name": "My Device",
  "version": "0.1.0",
  "description": "Integration with My Device API",
  "icon": "Cpu",
  "author": "Your Name",
  "sowelVersion": ">=0.10.0",
  "settings": [
    {
      "key": "api_url",
      "label": "API URL",
      "type": "text",
      "required": true,
      "placeholder": "http://192.168.1.50/api"
    },
    {
      "key": "polling_interval",
      "label": "Polling interval (seconds)",
      "type": "number",
      "required": false,
      "defaultValue": "300"
    }
  ]
}
```

### 7. Tester localement

Faites un symlink du répertoire du plugin dans le `plugins/` de Sowel :

```bash
# From the Sowel root
ln -s /path/to/sowel-plugin-my-device plugins/my-device
```

Puis enregistrez-le manuellement dans la base (Sowel auto-charge depuis la table `plugins`) :

```bash
# Using the Sowel API to install from a local path, or manually:
sqlite3 data/sowel.db "INSERT INTO plugins (id, version, enabled, installed_at, manifest) VALUES ('my-device', '0.1.0', 1, datetime('now'), readfile('plugins/my-device/manifest.json'));"
```

Démarrez Sowel, il va détecter et charger le plugin automatiquement. Vérifiez les logs pour la sortie de votre plugin :

```
[info] plugin:my-device -- Plugin started
```

---

## Découverte de devices

Quand votre plugin détecte des devices (depuis une API, MQTT, ou un scan local), enregistrez-les avec `deviceManager.upsertFromDiscovery()`.

### Signature

```typescript
deviceManager.upsertFromDiscovery(
  integrationId: string,     // Your plugin ID (e.g. "weather-forecast")
  source: string,            // Device source identifier (typically your plugin ID)
  discovered: DiscoveredDevice,
): void;
```

### Format DiscoveredDevice

```typescript
interface DiscoveredDevice {
  ieeeAddress?: string; // Optional hardware address (for Zigbee devices)
  friendlyName: string; // Unique device name -- used as sourceDeviceId for data updates
  manufacturer?: string; // Device manufacturer
  model?: string; // Device model
  data: {
    // Data points this device exposes
    key: string; // Data point key (e.g. "temperature", "j1_condition")
    type: string; // "number" | "boolean" | "text" | "enum"
    category: string; // "temperature" | "humidity" | "motion" | "battery" | etc.
    unit?: string; // Unit of measurement (e.g. "C", "%", "km/h")
  }[];
  orders: {
    // Commands this device accepts
    key: string; // Order key (e.g. "set_monitoring")
    type: string; // Value type: "boolean" | "number" | "enum" | "text"
    dispatchConfig: Record<string, unknown>; // Integration-specific config for order dispatch
    min?: number; // For numeric orders: minimum value
    max?: number; // For numeric orders: maximum value
    enumValues?: string[]; // For enum orders: allowed values
    unit?: string; // Unit (e.g. "C")
  }[];
}
```

### Exemple (depuis weather-forecast)

```typescript
const WEATHER_DISCOVERED_DEVICE: DiscoveredDevice = {
  friendlyName: "Weather Forecast",
  manufacturer: "Open-Meteo",
  model: "Forecast API",
  data: [
    { key: "j1_condition", type: "enum", category: "weather_condition" },
    { key: "j1_temp_min", type: "number", category: "temperature", unit: "C" },
    { key: "j1_temp_max", type: "number", category: "temperature", unit: "C" },
    { key: "j1_rain_prob", type: "number", category: "rain", unit: "%" },
    { key: "j1_wind_gusts", type: "number", category: "wind", unit: "km/h" },
    // ... j2 through j5
  ],
  orders: [],
};

// Call during poll
this.deviceManager.upsertFromDiscovery(PLUGIN_ID, SOURCE_DEVICE_ID, WEATHER_DISCOVERED_DEVICE);
```

**Important :**

- `friendlyName` devient le `source_device_id` dans la base. Il doit correspondre à l'argument `sourceDeviceId` utilisé dans `updateDeviceData()`.
- Appelez `upsertFromDiscovery()` à chaque cycle de poll, c'est idempotent (créé au premier appel, met à jour les métadonnées aux suivants).
- Incluez tous les data points et ordres dans la définition `DiscoveredDevice`. Les entrées de données/ordres obsolètes qui ne sont pas dans la découverte courante sont nettoyées automatiquement.

---

## Mises à jour de données device

Après la découverte de devices, poussez les mises à jour de données quand de nouvelles valeurs arrivent. Utilisez `deviceManager.updateDeviceData()`.

### Signature

```typescript
deviceManager.updateDeviceData(
  integrationId: string,                // Your plugin ID (e.g. "weather-forecast")
  sourceDeviceId: string,               // Must match friendlyName from upsertFromDiscovery
  payload: Record<string, unknown>,     // Flat key-value map of data points
): void;
```

### Exemple (depuis weather-forecast)

```typescript
const payload: Record<string, unknown> = {
  j1_condition: "rainy",
  j1_temp_min: 8.2,
  j1_temp_max: 14.5,
  j1_rain_prob: 75,
  j1_wind_gusts: 42,
  // ... j2 through j5
};

this.deviceManager.updateDeviceData(PLUGIN_ID, SOURCE_DEVICE_ID, payload);
```

**Critique :** le paramètre `sourceDeviceId` doit correspondre exactement au `friendlyName` utilisé dans `upsertFromDiscovery()`. C'est ainsi que Sowel retrouve le device dans la base. Dans le plugin weather-forecast, les deux sont définis à `"Weather Forecast"`.

Le payload est un **`Record<string, unknown>` plat**, les clés sont les noms de data points, les valeurs sont les valeurs brutes (number, boolean, string). Ce n'est pas un objet imbriqué avec labels ou unités, ceux-ci sont définis une seule fois dans `upsertFromDiscovery()`.

Cela déclenche le pipeline réactif :

1. Les données du device sont mises à jour dans SQLite
2. L'événement `device.data.updated` est émis
3. Les liaisons d'équipements sont réévaluées
4. Les agrégations de zones sont mises à jour
5. Les triggers de scénarios sont vérifiés
6. L'UI reçoit un push WebSocket

---

## Exécution d'ordres

Quand un utilisateur ou un scénario envoie une commande à un device géré par votre plugin, Sowel appelle `executeOrder()` sur l'instance de votre plugin.

### Signature

```typescript
executeOrder(
  device: Device,                             // The target device object
  dispatchConfig: Record<string, unknown>,    // Integration-specific config from the order definition
  value: unknown,                             // The value to set
): Promise<void>;
```

### Exemple

```typescript
async executeOrder(
  device: Device,
  dispatchConfig: Record<string, unknown>,
  value: unknown,
): Promise<void> {
  const action = dispatchConfig.action as string;

  switch (action) {
    case "set_monitoring":
      await this.api.setMonitoring(device.sourceDeviceId, value as boolean);
      break;
    default:
      this.logger.warn({ action }, "Unknown order action");
  }
}
```

**Flux d'un ordre :**

1. L'utilisateur appuie sur un bouton dans l'UI ou une action de scénario se déclenche
2. L'équipement dispatche l'ordre vers le device lié
3. Sowel route l'ordre vers l'intégration propriétaire du device
4. La méthode `executeOrder()` du plugin est appelée avec l'objet Device complet, le `dispatchConfig` issu de la définition d'ordre, et la valeur
5. Le plugin envoie la commande au device physique
6. Au prochain poll (ou refresh immédiat), le nouvel état est reflété

**Important — plugins basés sur MQTT** : ne figez pas le réglage `base_topic` dans `dispatchConfig.topic` pendant la découverte. À la place, stockez seulement le suffixe relatif au device (par ex. `topicSuffix: "garage/set"`) et résolvez le topic complet au runtime dans `executeOrder()` en utilisant le réglage `base_topic` courant. Cela garantit que les ordres restent corrects si l'utilisateur change le base topic. Utilisez `dispatchConfig.topic` comme fallback pour la rétrocompatibilité avec les entrées DB existantes.

Si votre plugin ne supporte pas les ordres (par ex. un plugin météo en lecture seule), levez une erreur :

```typescript
async executeOrder(): Promise<void> {
  throw new Error("Weather Forecast plugin does not support orders");
}
```

---

## Réglages

Les plugins déclarent leurs réglages dans `manifest.json` et retournent le même schéma depuis `getSettingsSchema()`. Sowel rend automatiquement un formulaire de configuration dans l'UI.

### Schéma de définition d'un réglage

```typescript
interface IntegrationSettingDef {
  key: string; // Setting key (without prefix). Stored as "integration.<pluginId>.<key>"
  label: string; // Display label in the UI
  type: string; // One of: "text", "password", "number", "boolean"
  required: boolean; // If true, must be filled before the plugin can start
  placeholder?: string; // Placeholder text in the input field
  defaultValue?: string; // Default value (always a string, even for numbers)
}
```

### Exemple (depuis netatmo-security)

```json
{
  "settings": [
    {
      "key": "client_id",
      "label": "Client ID",
      "type": "text",
      "required": true,
      "placeholder": "From dev.netatmo.com"
    },
    {
      "key": "client_secret",
      "label": "Client Secret",
      "type": "password",
      "required": true
    },
    {
      "key": "refresh_token",
      "label": "Refresh Token",
      "type": "password",
      "required": true,
      "placeholder": "With camera scopes"
    },
    {
      "key": "polling_interval",
      "label": "Polling interval (seconds)",
      "type": "number",
      "required": false,
      "defaultValue": "300",
      "placeholder": "Min 180, default 300"
    }
  ]
}
```

### Lire les réglages au runtime

Les réglages sont stockés avec la clé complète `integration.<pluginId>.<key>` :

```typescript
const SETTINGS_PREFIX = `integration.${PLUGIN_ID}.`;

// Read a plugin-specific setting
const interval = this.settingsManager.get(`${SETTINGS_PREFIX}polling_interval`);
// Returns "300" (string) or undefined if not set

// Read a global Sowel setting (no prefix)
const lat = this.settingsManager.get("home.latitude");

// Write a setting
this.settingsManager.set(`${SETTINGS_PREFIX}last_token_refresh`, Date.now().toString());
```

**Notes importantes :**

- `get()` retourne toujours `string | undefined`, parsez les nombres avec `parseInt()` / `parseFloat()`
- Le `defaultValue` du schéma de réglages est uniquement pour l'affichage UI, gérez toujours undefined dans le code
- Utilisez le type `"password"` pour les secrets, l'UI masque ces valeurs
- Il n'y a pas de types `"select"`, `"string"` ou `"secret"`. Les types valides sont : `"text"`, `"password"`, `"number"`, `"boolean"`

---

## Publication et versioning

### Créer un tarball de release

Les plugins sont installés depuis des tarballs de release GitHub. Le tarball **doit inclure** `dist/` (JS compilé) et **doit exclure** `src/` et `node_modules/`.

```bash
# Build first
npm run build

# Create the release tarball
tar -czf sowel-plugin-my-device-0.1.0.tar.gz \
  manifest.json \
  package.json \
  dist/
```

Si votre plugin a des dépendances de production (listées dans `dependencies`, pas `devDependencies`), incluez aussi `package.json` pour que Sowel puisse exécuter `npm install --production` après extraction. S'il n'y a pas de dépendances runtime, `package.json` est quand même recommandé mais `node_modules/` ne doit pas être inclus.

### Créer une release GitHub

```bash
gh release create v0.1.0 \
  sowel-plugin-my-device-0.1.0.tar.gz \
  --title "v0.1.0" \
  --notes "Initial release"
```

**Flux d'installation :** quand un utilisateur clique sur "Installer" dans le store de plugins Sowel, Sowel :

1. Récupère la dernière release depuis l'API GitHub
2. Préfère un asset `.tar.gz` uploadé (qui inclut `dist/`), retombe sur le tarball source GitHub
3. Extrait dans `plugins/<id>/`
4. Exécute `npm install --production` si `package.json` existe
5. Si `dist/` est manquant mais que `tsconfig.json` existe, tente `npx tsc` pour build depuis les sources
6. Enregistre le plugin dans la base et le charge

Bonne pratique : **uploadez toujours un tarball pré-compilé** comme asset de release. Cela évite à l'instance Sowel de l'utilisateur d'avoir besoin de TypeScript installé.

### Mettre à jour un plugin

Quand une version plus récente est disponible dans `registry.json` par rapport à la version installée, Sowel affiche un indicateur de mise à jour dans l'UI (badge sidebar, pastille header, et un bouton "Update" sur la carte du plugin).

**Flux de mise à jour** (déclenché par un clic sur "Update") :

1. Stoppe le plugin en cours
2. Télécharge la dernière release depuis GitHub (même logique que l'install)
3. Remplace les fichiers du plugin dans `plugins/<id>/`
4. Exécute `npm install` et build si nécessaire
5. Met à jour la version et le manifest dans la base
6. Redémarre le plugin s'il était activé

**Ce qui est préservé :** tous les réglages du plugin, les devices découverts, les liaisons d'équipement, et la configuration d'historisation. La mise à jour ne remplace que le code du plugin, elle ne touche pas la base.

**Ce qui change :** les fichiers du plugin dans `plugins/<id>/` et la version enregistrée dans la table `plugins`.

### S'enregistrer dans le store de plugins

Pour que votre plugin apparaisse dans le store de plugins Sowel, soumettez une PR sur le repo Sowel ajoutant une entrée à `plugins/registry.json` :

```json
{
  "id": "my-device",
  "type": "integration",
  "name": "My Device",
  "description": "Integration with My Device API",
  "icon": "Cpu",
  "author": "Your Name",
  "repo": "yourname/sowel-plugin-my-device",
  "version": "0.1.0",
  "tags": ["sensor", "api"]
}
```

#### Schéma d'entrée du registre

| Champ         | Type     | Requis | Description                                                                               |
| ------------- | -------- | ------ | ----------------------------------------------------------------------------------------- |
| `id`          | string   | Oui    | Doit correspondre à l'`id` du `manifest.json` du plugin                                   |
| `type`        | string   | Oui    | `integration` ou `recipe`, route vers PluginLoader ou RecipeLoader au moment de l'install |
| `name`        | string   | Oui    | Nom affiché dans le store                                                                 |
| `description` | string   | Oui    | Courte description                                                                        |
| `icon`        | string   | Oui    | Nom d'icône Lucide                                                                        |
| `author`      | string   | Oui    | Nom de l'auteur                                                                           |
| `repo`        | string   | Oui    | Chemin GitHub `owner/repo` (utilisé pour récupérer les releases)                          |
| `version`     | string   | Non    | Dernière version disponible (affichée dans l'onglet "Available" du store)                 |
| `tags`        | string[] | Oui    | Tags cherchables (par ex. `["camera", "security"]`)                                       |

#### Récupération du registre distant

Depuis la spec 059, Sowel récupère `plugins/registry.json` depuis `https://raw.githubusercontent.com/mchacher/sowel/main/plugins/registry.json` avec un cache d'une heure, retombant sur le fichier local livré dans l'image Docker. Cela signifie :

- **Publier une nouvelle version d'un plugin** ne nécessite que la mise à jour de `plugins/registry.json` sur `main`, pas besoin de release Sowel
- Les **forks privés** peuvent pointer Sowel vers leur propre registre en changeant `REGISTRY_URL` dans `package-manager.ts`
- Les **plugins sont re-téléchargés automatiquement** au démarrage du conteneur si leur répertoire est manquant (par ex. après une restauration de backup, spec 058)

### Sources personnelles (spec 136)

Depuis la spec 136, un troisième niveau de confiance existe à côté d'officiel et communautaire : les **sources personnelles**. Un admin peut enregistrer son propre dépôt GitHub comme source de plugins directement depuis l'UI (page Plugins, onglet Store, section "Sources personnelles"), sans aucune PR sur le registre, ni pour la première publication ni pour les montées de version. C'est la boucle recommandée pendant le développement d'un plugin pour sa propre instance.

| Niveau        | Listé dans                | Ancre d'intégrité                     | Friction à l'installation                     |
| ------------- | ------------------------- | ------------------------------------- | --------------------------------------------- |
| Officiel      | `registry.json` central   | SHA256 du registre + revue mainteneur | Aucune                                        |
| Communautaire | `registry.json` central   | SHA256 du registre + revue de la PR   | Modal de confirmation unique                  |
| Personnel     | Votre propre dépôt GitHub | SHA256 épinglé (TOFU)                 | Confirmation à l'installation et à chaque MAJ |

**Prérequis pour qu'un dépôt fonctionne comme source personnelle :**

- Dépôt GitHub public (pas encore de support de token).
- Une release GitHub dont les assets incluent un tarball `sowel-plugin-<id>-<version>.tar.gz` (ou `sowel-recipe-...`), le même artefact que pour le registre.
- Le `manifest.json` du tarball doit déclarer un `repo` égal au dépôt source (un écart refuse l'installation).
- L'`id` du plugin ne doit entrer en collision avec aucun id du registre central (masquer un plugin officiel est refusé).

**Modèle de confiance (TOFU, Trust On First Use) :** il n'existe pas de hash central pour une source personnelle, donc Sowel télécharge le tarball, calcule son SHA256 et l'affiche dans un modal de confirmation avec la version de la release. Une fois confirmé, le hash est épinglé en base. Tout changement de contenu, y compris une nouvelle release, déclenche une nouvelle confirmation montrant la nouvelle empreinte ; les restaurations de backup revérifient les téléchargements contre le hash épinglé. Retirer une source laisse les plugins installés en fonctionnement mais bloque installations et mises à jour futures depuis cette source.

!!! warning "Les plugins personnels exécutent du code non revu"
Personne n'a relu le code d'un plugin personnel. Il s'exécute avec tous les privilèges du processus serveur Sowel (le scoping de la spec 111 est une frontière souple, pas un bac à sable). N'ajoutez que des dépôts que vous possédez ou en qui vous avez pleinement confiance.

Quand votre plugin est prêt à être partagé, le niveau communautaire est la voie de promotion : ouvrez une PR sur le registre comme décrit ci-dessus.

### Versioning

Il y a **deux endroits** où la version compte, et ils ont des objectifs différents :

1. **`manifest.json` (dans le repo du plugin)** : le champ `version` ici est lu lors de l'installation du plugin. Il est stocké dans la base de Sowel et affiché dans l'**onglet "Installed"** de l'UI Plugins.

2. **`plugins/registry.json` (dans le repo Sowel)** : le champ `version` ici est affiché dans l'**onglet "Store"** de l'UI Plugins, montrant aux utilisateurs quelle version est disponible à l'installation.

**Règles :**

- Mettez à jour la version dans `manifest.json` à **chaque release**. C'est ainsi que Sowel sait quelle version est installée.
- Mettez à jour la version dans `plugins/registry.json` du repo Sowel quand vous publiez une nouvelle release. C'est ainsi que les utilisateurs voient qu'une mise à jour est disponible : Sowel compare la version installée (depuis le manifest) à la version du registre et affiche un badge de mise à jour si elles diffèrent.
- Gardez les deux versions en phase. Si `manifest.json` dit `0.2.0` mais `registry.json` dit `0.1.0`, le store affichera une version périmée.
- La version dans le tag de release (par ex. `v0.2.0`) doit correspondre à `manifest.json`.

### Convention de nommage des releases

- Tag git : `v0.2.0` (SemVer avec préfixe `v`)
- Asset tarball : `sowel-plugin-<id>-<version>.tar.gz`
- La `version` dans le `manifest.json` du tarball doit correspondre au tag de release

---

## Dépannage

**Le plugin n'est pas détecté :**

- Vérifiez que `plugins/<id>/manifest.json` existe et est un JSON valide
- Vérifiez que le champ `id` correspond au nom du répertoire
- Vérifiez la table `plugins` dans SQLite, le plugin doit avoir une ligne avec `enabled = 1`

**Le plugin échoue au chargement :**

- Assurez-vous que `dist/index.js` existe et exporte une fonction `createPlugin`
- Consultez les logs Sowel pour les entrées `plugin:<id>`
- Vérifiez que le plugin utilise ESM (`export function createPlugin` ou `export { createPlugin }`)
- Le loader vérifie aussi `mod.default?.createPlugin` en fallback

**Le plugin se charge mais ne démarre pas :**

- Vérifiez que `isConfigured()` renvoie true, Sowel saute `start()` quand c'est false
- Vérifiez que tous les réglages requis sont configurés dans l'UI (Administration > Intégrations)

**Les devices n'apparaissent pas :**

- Vérifiez que `integrationId` dans `upsertFromDiscovery()` correspond à l'`id` de votre plugin
- Vérifiez que `friendlyName` est non vide et unique
- Cherchez les erreurs dans les logs du device manager

**Les mises à jour de données ne fonctionnent pas :**

- Vérifiez que `sourceDeviceId` dans `updateDeviceData()` correspond exactement au `friendlyName` utilisé dans `upsertFromDiscovery()`
- Vérifiez que les clés du payload correspondent aux clés déclarées dans le tableau `DiscoveredDevice.data`

**Les ordres ne sont pas reçus :**

- Vérifiez que votre plugin implémente `executeOrder()` avec la bonne signature : `(device: Device, dispatchConfig: Record<string, unknown>, value: unknown)`
- Vérifiez que le tableau `orders` du device inclut la définition d'ordre avec un `dispatchConfig`
- Cherchez les événements de dispatch d'ordre dans les logs

---

## Référence

- [Architecture Sowel](architecture.md) : vue d'ensemble de l'architecture technique
- [Plugin Weather Forecast](https://github.com/mchacher/sowel-plugin-weather-forecast) : exemple complet et fonctionnel
- [Plugin Netatmo Security](https://github.com/mchacher/sowel-plugin-netatmo-security) : plugin avec OAuth et ordres
