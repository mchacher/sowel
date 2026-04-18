# Spec 075 — Architecture

## File Changes

### sowel-plugin-legrand-energy/src/index.ts

1. **IntegrationPlugin interface**: add `apiVersion`, update `executeOrder` signature
2. **DiscoveredDevice interface**: `dispatchConfig` optional in orders
3. **Plugin class**: add `readonly apiVersion = 2`
4. **executeOrder**: update signature (still throws "not supported")

### Sowel core

No changes needed.

## Categories (verified)

| Data key     | Current category | Correct |
| ------------ | ---------------- | ------- |
| power        | `power`          | ✓       |
| energy       | `energy`         | ✓       |
| autoconso    | `energy`         | ✓       |
| injection    | `energy`         | ✓       |
| demand_30min | `power`          | ✓       |

All categories already correct.
