---
name: plugin-integration
description: Create a new plugin integration for Sowel — covers plugin code, new equipment types, UI bindings, zone cards, dashboard widgets, and all required touchpoints. Use when creating a new plugin, adding a new device source, or adding new equipment types.
user-invocable: true
argument-hint: "[plugin-name]"
---

# Sowel Plugin Integration Workflow

Follows the same process as `/sowel-feature`: spec → user approval → branch → implement → test → PR → user approval → merge.

---

## Phase 1: Understand & Clarify

### 1.1 Read Essential Documentation

Before starting, read these files:

| Document                                   | Purpose                                     |
| ------------------------------------------ | ------------------------------------------- |
| `src/shared/types.ts`                      | EquipmentType union, IntegrationPlugin, etc |
| `src/shared/plugin-api.ts`                 | PluginDeps interface, PluginFactory type    |
| `src/plugins/plugin-manager.ts`            | Plugin lifecycle (load, install, update)    |
| `src/integrations/integration-registry.ts` | IntegrationPlugin interface                 |
| `CLAUDE.md`                                | Project conventions and rules               |

Also study an existing plugin for reference:

- `sowel-plugin-weather-forecast` — simple polling plugin (read-only)
- `sowel-plugin-smartthings` — polling + orders plugin (read/write)

### 1.2 Deep-Dive Requirements

**IMPORTANT**: Do not assume. Ask clarifying questions until requirements are crystal clear.

| Topic               | Questions to ask                                                   |
| ------------------- | ------------------------------------------------------------------ |
| **API**             | What external API? Auth method (token, OAuth, local)? Rate limits? |
| **Devices**         | What device types will be discovered? What data does each expose?  |
| **Equipment types** | Do existing types fit, or do we need new ones?                     |
| **Orders**          | What commands can be sent? What's the API contract?                |
| **Polling**         | What interval? What data changes frequently vs. rarely?            |
| **Energy**          | Does the device expose energy data? Cumulative or delta?           |
| **Edge cases**      | API down? Device offline? Token expired? Rate limited?             |
| **Testing**         | Does the user have real devices to test with? API credentials?     |

**Continue asking until you can write a complete spec without assumptions.**

### 1.3 Test the API First

Before writing a spec, test the external API with a script:

```bash
# Create scripts/<api>-test.py to explore the API
# List devices, check capabilities, test commands
# Share results with user to confirm scope
```

---

## Phase 2: Document the Spec

Every plugin MUST be documented in `specs/`. Use English only.

### 2.1 Create Spec Folder

```bash
ls specs/ | tail -1  # Find last number
mkdir specs/XXX-plugin-<name>
```

### 2.2 Create spec.md

```markdown
# Plugin: <Name>

## Summary

Brief description.

## Acceptance Criteria

- [ ] Plugin discovers devices
- [ ] Data polling works at configured interval
- [ ] Orders execute correctly
- [ ] New equipment types display in UI (if applicable)

## Scope

### In Scope

- ...

### Out of Scope

- ...

## Edge Cases

- API auth failure
- Device offline
- Rate limiting
```

---

## Phase 2b: User Validation (REQUIRED)

**CRITICAL**: Do NOT proceed to implementation without explicit user approval.

Present a summary:

```
## Résumé de la spécification

**Plugin**: [Name]
**Devices**: [What will be discovered]
**Data**: [Key data points per device type]
**Orders**: [Commands available]
**New equipment types**: [If any]
**Polling**: [Interval]

Voulez-vous que j'implémente ce plugin ?
```

Wait for approval before proceeding.

---

## Phase 3: Branch & Implement

### 3.1 Create Feature Branch (in Sowel repo if core changes needed)

```bash
git checkout main && git pull
git checkout -b feat/plugin-<name>
```

### 3.2 Plugin Code (External Repo)

#### Repo structure

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

#### Plugin interface — MUST match exactly

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

- `getSettings()` must be `getSettingsSchema()`
- `executeOrder(deviceSourceId, key, value)` must be `executeOrder(device, dispatchConfig, value)`
- Missing `eventBus.emit()` for connect/disconnect events
- `SettingsManager.get()` returns `undefined` not `null` — use `!!` for truthy checks

#### Type definitions

Copy local type definitions from `sowel-plugin-smartthings/src/index.ts`. These types mirror Sowel's internal types without importing them.

#### Device discovery

```typescript
deviceManager.upsertFromDiscovery(INTEGRATION_ID, SOURCE, discoveredDevice);
deviceManager.updateDeviceData(INTEGRATION_ID, sourceDeviceId, { key1: value1 });
```

#### Orders with dispatchConfig

```typescript
orders: [
  { key: "power", type: "boolean", dispatchConfig: { command: "switch" } },
  { key: "input_source", type: "enum", enumValues: [...], dispatchConfig: { command: "setInputSource" } },
]
```

### 3.3 New Equipment Types (Sowel Core — if needed)

**Every new equipment type requires changes in ALL of the following files. Missing any will cause broken UI.**

| #   | File                                                | What to add                                                      |
| --- | --------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | `src/shared/types.ts`                               | Add to `EquipmentType` union type                                |
| 2   | `src/equipments/equipment-manager.ts`               | Add to `VALID_EQUIPMENT_TYPES` set                               |
| 3   | `ui/src/types.ts`                                   | Add to `EquipmentType` union type (mirror backend)               |
| 4   | `ui/src/components/equipments/EquipmentForm.tsx`    | Add to `EQUIPMENT_TYPE_KEYS` array with label + i18n key         |
| 5   | `ui/src/components/equipments/EquipmentCard.tsx`    | Add to `TYPE_ICONS` and `TYPE_LABELS` records                    |
| 6   | `ui/src/components/equipments/DeviceSelector.tsx`   | Add to `EQUIPMENT_TYPE_CATEGORIES` or `EQUIPMENT_TYPE_DATA_KEYS` |
| 7   | `ui/src/components/equipments/bindingUtils.ts`      | Add to `RELEVANT_DATA` and `RELEVANT_ORDERS`                     |
| 8   | `ui/src/components/equipments/useEquipmentState.ts` | Add `isXxx` boolean flag                                         |
| 9   | `ui/src/components/home/ZoneEquipmentsView.tsx`     | Add to `EQUIPMENT_GROUPS` (or existing group)                    |
| 10  | `ui/src/components/home/CompactEquipmentCard.tsx`   | Add compact info card rendering for zone view                    |
| 11  | `ui/src/components/dashboard/EquipmentWidget.tsx`   | Add desktop widget rendering                                     |
| 12  | `ui/src/components/dashboard/MobileWidgetCard.tsx`  | Add mobile widget rendering                                      |
| 13  | `ui/src/pages/EquipmentDetailPage.tsx`              | Add detail panel dispatcher                                      |
| 14  | `ui/src/components/equipments/<Type>Panel.tsx`      | Create detail panel component (if interactive)                   |
| 15  | `ui/src/i18n/locales/en.json`                       | Add `equipments.type.<type>` key                                 |
| 16  | `ui/src/i18n/locales/fr.json`                       | Same key in French                                               |

#### DeviceSelector filtering

- **By category** (`EQUIPMENT_TYPE_CATEGORIES`): when data category is specific (e.g., `light_state`)
- **By data keys** (`EQUIPMENT_TYPE_DATA_KEYS`): when category is too broad (e.g., `generic`). Use specific keys.

#### Zone info card (CompactEquipmentCard.tsx)

Show the most relevant 1-2 values per equipment type.

#### Dashboard widget (EquipmentWidget.tsx + MobileWidgetCard.tsx)

Desktop: full `WidgetCard` (h-[160px] sm:h-[240px]) with icon + data + controls.
Mobile: compact button with icon + primary value.

#### Detail page panel

Interactive controls for the equipment type. Create a dedicated `<Type>Panel.tsx` component.

### 3.4 Registry

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

### 3.5 Implementation Rules

Same rules as `/sowel-feature`:

- TypeScript strict, no `any`
- Pino structured logging (never `console.*`)
- Tailwind only, Lucide icons
- All types in `src/shared/types.ts`

---

## Phase 4: Test & Validate

### 4.1 TypeScript Compilation (MUST pass)

```bash
npx tsc --noEmit          # Backend
cd ui && npx tsc --noEmit  # Frontend
```

### 4.2 Run Tests

```bash
npm run test
```

### 4.3 Functional Test Checklist

1. Install plugin from store
2. Configure settings (token, etc.)
3. Start integration → devices appear
4. Create equipment with new type → **auto-binding works** (data + orders)
5. Equipment detail page shows **data + interactive controls**
6. Zone/home view shows **compact info card**
7. Dashboard widget renders on **desktop and mobile**
8. Orders work (power, source, etc.)
9. Historization works (if applicable)
10. Plugin update works (bump version, update from UI)

### 4.4 Lint

```bash
npx eslint src/ --ext .ts
cd ui && npx eslint src/ --ext .ts,.tsx
```

---

## Phase 5: Documentation & Commit

### 5.1 Update Documentation

Use `/update-docs` to update:

| Document                               | What to update                 |
| -------------------------------------- | ------------------------------ |
| `docs/user/equipments.md`              | New equipment type description |
| `docs/technical/plugin-development.md` | If new patterns introduced     |
| `specs/XXX-plugin-<name>/spec.md`      | Mark acceptance criteria [x]   |

### 5.2 Plugin Release

```bash
cd sowel-plugin-<name>
npm run build
git add -A && git commit -m "feat: v0.1.0"
git tag v0.1.0 && git push && git push --tags
tar -czf /tmp/sowel-plugin-<name>-0.1.0.tar.gz --exclude=node_modules --exclude=.git .
gh release create v0.1.0 /tmp/sowel-plugin-<name>-0.1.0.tar.gz --title "v0.1.0" --notes "Initial release"
```

---

## Phase 6: Pull Request & Merge

### 6.1 Push Branch

```bash
git push -u origin feat/plugin-<name>
```

### 6.2 Create Pull Request

```bash
gh pr create --title "feat: plugin <name> integration" --body "$(cat <<'EOF'
## Summary
- Plugin: ...
- New equipment types: ...
- Devices: ...

## Changes
- Plugin repo: ...
- Core: new types, UI components
- Registry: updated

## Test plan
- [x] TypeScript compiles (zero errors)
- [x] All tests pass
- [x] Plugin installs from store
- [x] Devices discovered
- [x] Equipment creation + auto-binding
- [x] Detail page + controls
- [x] Zone card + dashboard widget (desktop + mobile)
- [x] Orders work
EOF
)"
```

### 6.3 Wait for User Approval

**Do NOT merge without user confirmation.**

Ask: "PR créée: [URL]. Voulez-vous que je merge dans main ?"

### 6.4 Merge & Cleanup

Once user approves:

```bash
gh pr merge <number> --merge --delete-branch
git checkout main && git pull
```
