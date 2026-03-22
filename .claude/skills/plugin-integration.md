---
name: plugin-integration
description: Create a new plugin integration for Sowel — covers plugin code, new equipment types, UI bindings, zone cards, and all required touchpoints.
user_invocable: true
trigger: |
  - User asks to create a new plugin/integration
  - User says "créer un plugin", "nouvelle intégration", "ajouter une intégration"
  - Working on a new device source (Samsung, Netatmo, etc.)
---

# Sowel Plugin Integration Workflow

This skill covers the **full lifecycle** of adding a new plugin integration to Sowel:

1. Plugin code (external repo)
2. New equipment types (if needed, in Sowel core)
3. All UI touchpoints for new equipment types
4. Zone info cards
5. Registry and documentation

---

## Phase 1: Plugin Code (External Repo)

### 1.1 Create repo

```
sowel-plugin-<name>/
├── manifest.json
├── package.json
├── tsconfig.json
├── README.md
├── .gitignore          # node_modules/ dist/
└── src/
    └── index.ts
```

### 1.2 Plugin interface — MUST match exactly

The plugin **must** implement this interface. Any deviation will crash the integrations page.

```typescript
interface IntegrationPlugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string; // Lucide icon name

  getStatus(): IntegrationStatus; // NOT getState()
  isConfigured(): boolean;
  getSettingsSchema(): IntegrationSettingDef[]; // NOT getSettings()

  start(options?: { pollOffset?: number }): Promise<void>;
  stop(): Promise<void>;

  executeOrder( // NOT executeOrder(sourceId, key, value)
    device: Device,
    dispatchConfig: Record<string, unknown>,
    value: unknown,
  ): Promise<void>;

  refresh?(): Promise<void>;
  getPollingInfo?(): { lastPollAt: string; intervalMs: number } | null;
}
```

**Common mistakes to avoid:**

- `getSettings()` → must be `getSettingsSchema()`
- `executeOrder(deviceSourceId, key, value)` → must be `executeOrder(device, dispatchConfig, value)`
- Missing `eventBus.emit()` for connect/disconnect events
- `SettingsManager.get()` returns `undefined` not `null` — use `!!` for truthy checks

### 1.3 Type definitions (copy from weather-forecast plugin)

Copy the local type definitions block from `sowel-plugin-weather-forecast/src/index.ts`. These types mirror Sowel's internal types without importing them:

- `Logger` (with `child()` method)
- `EventBus` (with `emit()`)
- `SettingsManager` (with `get()` and `set()`)
- `DeviceManager` (with `upsertFromDiscovery()` and `updateDeviceData()`)
- `DiscoveredDevice` (with `data[]` and `orders[]` including `dispatchConfig`)
- `Device` (with `id`, `integrationId`, `sourceDeviceId`, `name`)
- `PluginDeps`, `IntegrationPlugin`, `IntegrationSettingDef`

### 1.4 Device discovery

```typescript
// Each device = one DiscoveredDevice with data + orders
deviceManager.upsertFromDiscovery(INTEGRATION_ID, SOURCE, discoveredDevice);

// Data updates use payload object (NOT individual key calls)
deviceManager.updateDeviceData(INTEGRATION_ID, sourceDeviceId, {
  key1: value1,
  key2: value2,
});
```

### 1.5 Orders with dispatchConfig

Orders must include `dispatchConfig` in discovery so the equipment-manager can pass it back during execution:

```typescript
orders: [
  { key: "power", type: "boolean", dispatchConfig: { command: "switch" } },
  { key: "volume", type: "number", min: 0, max: 100, dispatchConfig: { command: "setVolume" } },
];
```

### 1.6 Release

```bash
npm run build
git add -A && git commit -m "feat: initial release"
git tag v0.1.0 && git push && git push --tags
tar -czf /tmp/sowel-plugin-<name>-0.1.0.tar.gz --exclude=node_modules --exclude=.git .
gh release create v0.1.0 /tmp/sowel-plugin-<name>-0.1.0.tar.gz --title "v0.1.0" --notes "Initial release"
```

---

## Phase 2: New Equipment Types (Sowel Core)

If the plugin introduces new device categories that don't map to existing equipment types, create new types. **Every new equipment type requires changes in ALL of the following files.**

### 2.1 Checklist — ALL files to modify

| #   | File                                              | What to add                                                      |
| --- | ------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | `src/shared/types.ts`                             | Add to `EquipmentType` union type                                |
| 2   | `src/equipments/equipment-manager.ts`             | Add to `VALID_EQUIPMENT_TYPES` set                               |
| 3   | `ui/src/types.ts`                                 | Add to `EquipmentType` union type (mirror)                       |
| 4   | `ui/src/components/equipments/EquipmentForm.tsx`  | Add to `EQUIPMENT_TYPE_KEYS` array                               |
| 5   | `ui/src/components/equipments/EquipmentCard.tsx`  | Add to `TYPE_ICONS` and `TYPE_LABELS` records                    |
| 6   | `ui/src/components/equipments/DeviceSelector.tsx` | Add to `EQUIPMENT_TYPE_CATEGORIES` or `EQUIPMENT_TYPE_DATA_KEYS` |
| 7   | `ui/src/components/equipments/bindingUtils.ts`    | Add to `RELEVANT_DATA` and `RELEVANT_ORDERS`                     |
| 8   | `ui/src/components/home/ZoneEquipmentsView.tsx`   | Add to `EQUIPMENT_GROUPS` (or existing group)                    |
| 9   | `ui/src/components/home/CompactEquipmentCard.tsx` | Add compact info card rendering                                  |
| 10  | `ui/src/i18n/locales/en.json`                     | Add `equipments.type.<type>` and `equipments.group.<group>` keys |
| 11  | `ui/src/i18n/locales/fr.json`                     | Same keys in French                                              |

**Missing any of these will cause:** empty dropdowns, missing icons, broken auto-binding, empty zone cards, TypeScript errors on `Record<EquipmentType, ...>`.

### 2.2 DeviceSelector filtering

Choose the right filtering strategy:

- **By category** (`EQUIPMENT_TYPE_CATEGORIES`): when the data category is specific enough (e.g., `light_state`, `shutter_position`)
- **By data keys** (`EQUIPMENT_TYPE_DATA_KEYS`): when category is too broad (e.g., `generic`). Use specific keys like `volume`, `remaining_time`

### 2.3 Auto-binding (bindingUtils.ts)

- `RELEVANT_DATA`: which data categories to bind. Must include all categories the plugin exposes for this type.
- `RELEVANT_ORDERS`: which order keys to bind. List the exact order keys from the plugin's `orders[]`.
- `STANDARD_ALIASES`: optional key→alias remapping (e.g., `targetTemperature` → `setpoint`)

### 2.4 Zone info card (CompactEquipmentCard.tsx)

Every equipment type needs a compact rendering in the zone/home view. Add a case in `CompactEquipmentCard` using `useEquipmentState`:

```typescript
// In useEquipmentState.ts — add detection flag
const isMediaPlayer = equipment.type === "media_player";

// In CompactEquipmentCard.tsx — add rendering
{isMediaPlayer && <CompactMediaPlayer equipment={equipment} />}
```

Show the most relevant 1-2 values (e.g., source + volume for TV, state + remaining time for washer).

---

## Phase 3: Registry and Documentation

### 3.1 Plugin registry

Add entry to `plugins/registry.json`:

```json
{
  "id": "<plugin-id>",
  "name": "Plugin Name",
  "description": "Short description",
  "icon": "LucideIconName",
  "author": "author",
  "repo": "owner/sowel-plugin-<name>",
  "version": "0.1.0",
  "tags": ["tag1", "tag2"]
}
```

### 3.2 Documentation

Update these docs (use `/update-docs` skill):

- `docs/user/equipments.md` — add new equipment type description
- `docs/technical/plugin-development.md` — if new patterns introduced
- `docs/technical/api-reference.md` — if new API endpoints

---

## Phase 4: Verification

### 4.1 Type-check

```bash
npx tsc --noEmit          # Backend
cd ui && npx tsc --noEmit  # Frontend
```

Both must pass with **zero errors**. `Record<EquipmentType, ...>` will catch missing entries.

### 4.2 Functional test

1. Install plugin from store
2. Configure settings (token, etc.)
3. Start integration → devices appear
4. Create equipment with new type → auto-binding works
5. Verify equipment detail page shows data
6. Verify zone/home view shows compact info card
7. Verify dashboard widget (if applicable)
8. Test orders (if applicable)

### 4.3 Conformity check

Before loading a plugin, verify it exposes required methods:

- `id`, `name`, `description`, `icon` (readonly properties)
- `getStatus()`, `isConfigured()`, `getSettingsSchema()` (required methods)
- `start()`, `stop()`, `executeOrder()` (required async methods)

---

## Quick Reference — Equipment Type Icons

| Type           | Lucide Icon                        | Import         |
| -------------- | ---------------------------------- | -------------- |
| `media_player` | `Tv`                               | `lucide-react` |
| `appliance`    | `WashingMachine`                   | `lucide-react` |
| `sensor`       | `Gauge`                            | `lucide-react` |
| `thermostat`   | `Thermometer`                      | `lucide-react` |
| `light_*`      | `Lightbulb` / `SunDim` / `Palette` | `lucide-react` |
| `shutter`      | `ShutterClosedIcon`                | custom         |
| `gate`         | `DoorOpen`                         | `lucide-react` |
| `energy_*`     | `Zap`                              | `lucide-react` |
