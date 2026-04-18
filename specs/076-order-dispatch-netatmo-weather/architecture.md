# Spec 076 — Architecture

## File Changes

### sowel-plugin-netatmo-weather/src/index.ts

1. **IntegrationPlugin interface**: add `apiVersion`, update `executeOrder` signature
2. **DiscoveredDevice interface**: `dispatchConfig` optional in orders
3. **Plugin class**: add `readonly apiVersion = 2`
4. **executeOrder**: update signature (still throws "read-only")

### Sowel core

No changes needed.
