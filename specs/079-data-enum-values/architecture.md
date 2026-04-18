# Spec 079 — Architecture

## Data Model Changes

### Migration: `005_device_data_enum_values.sql`

```sql
ALTER TABLE device_data ADD COLUMN enum_values JSON;
```

### Types (`src/shared/types.ts`)

Add `enumValues` to `DiscoveredDevice.data` entries:

```typescript
data: {
  key: string;
  type: DataType;
  category: DataCategory;
  unit?: string;
  enumValues?: string[];  // NEW
}[];
```

Add `enumValues` to `DataBindingWithValue`:

```typescript
export interface DataBindingWithValue extends DataBinding {
  // ... existing fields ...
  enumValues?: string[]; // NEW
}
```

### UI Types (`ui/src/types.ts`)

Mirror the backend change in `DataBindingWithValue`.

## Files to Modify

### Backend

| File                                         | Change                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| `migrations/005_device_data_enum_values.sql` | Add `enum_values` column                                               |
| `src/shared/types.ts`                        | Add `enumValues` to `DiscoveredDevice.data` and `DataBindingWithValue` |
| `src/devices/device-manager.ts`              | Store/read `enum_values` in device_data upsert + DeviceDataRow         |
| `src/equipments/equipment-manager.ts`        | Include `dd.enum_values` in data binding SQL query + mapper            |

### Z2M Plugin

| File                                         | Change                                                         |
| -------------------------------------------- | -------------------------------------------------------------- |
| `sowel-plugin-zigbee2mqtt/src/z2m-parser.ts` | Add `enumValues: expose.values` to data entries for enum types |

### Frontend

| File                                                    | Change                                             |
| ------------------------------------------------------- | -------------------------------------------------- |
| `ui/src/types.ts`                                       | Add `enumValues` to `DataBindingWithValue`         |
| `ui/src/components/equipments/ButtonActionsSection.tsx` | Use enum values from equipment action data binding |

## Data Flow

```
Z2M expose.values (discovery)
  → z2m-parser: DiscoveredDevice.data[].enumValues
    → device-manager: INSERT INTO device_data ... enum_values = JSON
      → equipment-manager: SELECT ... dd.enum_values FROM data_bindings JOIN device_data
        → API response: DataBindingWithValue.enumValues
          → UI ButtonActionsSection: dynamic action value list
```
