# Plugin Integration Reference

## New Equipment Type — Full Touchpoint Checklist

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

## DeviceSelector Filtering

- **By category** (`EQUIPMENT_TYPE_CATEGORIES`): when data category is specific (e.g., `light_state`)
- **By data keys** (`EQUIPMENT_TYPE_DATA_KEYS`): when category is too broad (e.g., `generic`). Use specific keys.

## Zone Info Card (CompactEquipmentCard.tsx)

Show the most relevant 1-2 values per equipment type.

## Dashboard Widget (EquipmentWidget.tsx + MobileWidgetCard.tsx)

- Desktop: full `WidgetCard` (h-[160px] sm:h-[240px]) with icon + data + controls
- Mobile: compact button with icon + primary value

## Orders with dispatchConfig

```typescript
orders: [
  { key: "power", type: "boolean", dispatchConfig: { command: "switch" } },
  { key: "input_source", type: "enum", enumValues: [...], dispatchConfig: { command: "setInputSource" } },
]
```

## Plugin manifest.json Template

```json
{
  "id": "<plugin-id>",
  "name": "Plugin Name",
  "version": "0.1.0",
  "description": "Short description",
  "icon": "LucideIconName",
  "repo": "owner/sowel-plugin-<name>",
  "author": "author",
  "sowelVersion": ">=0.10.0",
  "settings": [
    { "key": "api_key", "label": "API Key", "type": "password", "required": true },
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

## Registry Entry Template

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
