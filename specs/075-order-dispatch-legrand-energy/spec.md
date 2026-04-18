# Spec 075 — Order Dispatch: Legrand Energy Migration

**Depends on**: spec 067 (core refactoring)

## Summary

Migrate the legrand-energy plugin to apiVersion 2 for interface coherence. This is a read-only plugin (executeOrder throws) — no functional change, only interface alignment.

## Changes

- `apiVersion: 2` on plugin class
- `executeOrder` signature updated to `(device, orderKey, value)` (still throws)
- Local interfaces updated (IntegrationPlugin, DiscoveredDevice)
- Verify energy categories are correct (already `power` and `energy`)

## Acceptance Criteria

- [x] Plugin declares `apiVersion: 2`
- [x] Local interfaces aligned with v2
- [x] Categories verified correct (power, energy)
- [x] Build succeeds
- [ ] Released as legrand-energy v2.0.0
- [ ] Registry updated
