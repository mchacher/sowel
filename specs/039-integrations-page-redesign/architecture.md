# Architecture: Integrations Page Redesign

## Data Model Changes

### IntegrationInfo (types.ts) — enriched

Add to backend IntegrationInfo:

- `deviceCount: number` — count of devices with this integrationId
- `offlineDeviceCount: number` — count of offline devices

No new DB tables, no migrations.

## API Changes

### GET /api/v1/integrations (modified)

Response now includes per-integration:

```typescript
{
  ...existingFields,
  deviceCount: number,
  offlineDeviceCount: number,
}
```

### POST /api/v1/integrations/:id/restart (new)

- Admin only
- Stops then starts the integration
- Returns `{ success: boolean; status: string }`

## Event Bus Events

- No new events. Uses existing `system.integration.status_changed` for WebSocket push.

## UI Changes

### New Components

| Component         | File                                                   | Description                      |
| ----------------- | ------------------------------------------------------ | -------------------------------- |
| IntegrationsPage  | `ui/src/pages/IntegrationsPage.tsx`                    | Rewrite: compact list            |
| IntegrationRow    | `ui/src/components/integrations/IntegrationRow.tsx`    | Single row with status + actions |
| IntegrationDrawer | `ui/src/components/integrations/IntegrationDrawer.tsx` | Slide-out panel with config      |
| PollCountdown     | (keep existing logic, move to IntegrationRow)          | Countdown timer                  |

### Drawer behavior

- Desktop: slide from right, 480px wide, overlay backdrop
- Mobile (<640px): full-screen slide from right
- Close: X button, click backdrop, Escape key

## File Changes

| File                                                   | Change                                                   |
| ------------------------------------------------------ | -------------------------------------------------------- |
| `src/shared/types.ts`                                  | Add deviceCount, offlineDeviceCount to IntegrationInfo   |
| `src/api/routes/integrations.ts`                       | Enrich response with device counts, add restart endpoint |
| `ui/src/types.ts`                                      | Mirror IntegrationInfo changes                           |
| `ui/src/api.ts`                                        | Add restartIntegration() function                        |
| `ui/src/pages/IntegrationsPage.tsx`                    | Full rewrite: list + drawer                              |
| `ui/src/components/integrations/IntegrationRow.tsx`    | New component                                            |
| `ui/src/components/integrations/IntegrationDrawer.tsx` | New component                                            |
