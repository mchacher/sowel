# Spec 074 — Architecture

## Before (current)

```
IntegrationPlugin.executeOrder(device, orderKeyOrDispatchConfig: string | Record, value)
IntegrationRegistry.dispatchOrder() — routes v1 (dispatchConfig) or v2 (orderKey) based on apiVersion
EquipmentManager — parses dispatch_config JSON, passes to registry
Zone orders — category lookup + brute-force fallback
```

## After (target)

```
IntegrationPlugin.executeOrder(device, orderKey: string, value)
IntegrationRegistry.dispatchOrder() — always passes orderKey
EquipmentManager — passes orderKey directly, no dispatchConfig
Zone orders — category lookup only, no fallback
```

## Migration

SQLite doesn't support ALTER TABLE DROP COLUMN for columns with constraints. Rebuild:

```sql
-- Create new table without legacy columns
CREATE TABLE device_orders_new (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  type TEXT NOT NULL,
  category TEXT,
  min_value REAL,
  max_value REAL,
  enum_values JSON,
  unit TEXT,
  UNIQUE(device_id, key)
);

-- Copy data
INSERT INTO device_orders_new (id, device_id, key, type, category, min_value, max_value, enum_values, unit)
SELECT id, device_id, key, type, category, min_value, max_value, enum_values, unit
FROM device_orders;

-- Replace
DROP TABLE device_orders;
ALTER TABLE device_orders_new RENAME TO device_orders;
```

## Files to modify

- `src/shared/types.ts` — remove dispatchConfig, apiVersion
- `ui/src/types.ts` — mirror
- `src/integrations/integration-registry.ts` — simplify executeOrder + dispatchOrder
- `src/equipments/equipment-manager.ts` — remove dispatchConfig handling, brute-force fallback
- `src/devices/device-manager.ts` — remove dispatchConfig from DiscoveredDevice + upsert
- `ui/src/pages/DeviceDetailPage.tsx` — remove topic column
- `migrations/004_drop_dispatch_config.sql` — table rebuild
- All test files — update seedDevice, remove dispatchConfig references
