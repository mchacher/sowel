# Spec 101 — Activity Feed (Zone view right column)

> Phase 7 of the [094 UI redesign umbrella](../094-ui-redesign/spec.md). Replaces the original "light scoping spec" with the full design after Phase 1 discovery.

## Problem

The zone view has no answer to "what just happened here?". To investigate today, users open Logs (technical, cross-zone, raw) or guess from current equipment state. The polished mock ([ui-redesign-B-polished.html](../094-ui-redesign/mockups/ui-redesign-B-polished.html) lines 2800-2840) introduces an `ActivityPanel` in the zone view's right column that shows the last hour of events, grouped by time bucket, with semantic icon colors and human-readable wording like "Appliques x2 → 4 % par Motion Light".

Two backend gaps block the mock's UX:

1. `equipment.order.executed` carries no `source` field, so we can't say "par Motion Light" without a fragile client-side correlation.
2. The WebSocket store consumes events and discards them, so a page reload starts the feed empty while the mock implies an hour of history.

## Goal

Ship an `ActivityPanel` that matches the polished mock:

- Lives in the right column of the zone view, below `Comportements` (slot already reserved at [HomePage.tsx:207](../../ui/src/pages/HomePage.tsx#L207)).
- Shows the last 50 activity items (≈1 hour cap), grouped by hour bucket, with 4 visual categories (recipe / mode / motion / neutral) plus alarm.
- Source-attributes orders ("par Motion Light", "par le calendrier", "manuel") using a new `source` field threaded through `executeOrder()`.
- Bootstraps from a backend in-memory ring buffer at mount, then keeps live via WebSocket.
- Coalesces simultaneous orders from the same source within a 500 ms window (so 3 orders to 3 lights become one row).
- Mobile variant uses the tighter `.mob__act` layout already in the mock.

## Non-negotiable constraints

> **No persistence.** The ring buffer is in-memory only and resets on container restart. Same lifetime as the existing logs ring buffer.
>
> **No new dependencies.** Reuse existing event bus, Fastify server, ws server, Zustand stores, i18next.
>
> **Backward-compatible `executeOrder()`.** The new `source` parameter is optional. All existing call sites compile unchanged; missing source becomes `{ kind: "external", channel: "unknown" }` at the activity layer.

## In scope

### Backend

1. **Source attribution on orders** (context-bound dispatcher pattern, see architecture.md §10)
   - New `OrderSource` discriminated union in `src/shared/types.ts`.
   - `executeOrder(equipmentId, alias, value, source?)` signature in `src/equipments/equipment-manager.ts`. The new `source` is optional and additive (plugin-safe).
   - `equipment.order.executed` event gains `source?: OrderSource`.
   - `RecipeContext` gains a `dispatchOrder(equipmentId, alias, value)` closure pre-bound to `{ kind: "recipe", instanceId, recipeName }`. Built per-invocation in `recipe-manager.buildContext()`.
   - Internal recipe helpers migrate from `ctx.equipmentManager.executeOrder(...)` to `ctx.dispatchOrder(...)`. External recipe plugins keep using `ctx.equipmentManager` and degrade gracefully (no attribution).
   - Mode applier builds a local dispatcher closure with `{ kind: "mode", modeId, modeName }` for its apply scope.
   - Direct leaf callers pass source inline:
     - `src/buttons/button-manager.ts` — `{ kind: "button", buttonId }`
     - `src/api/routes/equipments.ts` (POST `/equipments/:id/orders`) — `{ kind: "manual", userId }`
     - `src/api/routes/zones.ts` (zone-level orders) — same.

2. **ActivityBuffer module** (`src/activity/activity-buffer.ts`)
   - Subscribes to the event bus for the eligible event set (below).
   - Resolves names + `zoneId` server-side (equipment → zone, recipe instance → zone slot, etc.).
   - Stores up to 200 `ActivityItem` records with a 1h TTL (purged on insert).
   - Emits `activity.added` on the event bus for WS push.
   - Exposes `getItems({ zoneId, includeDescendants, limit })` for the REST route.

3. **REST endpoint**
   - `GET /api/v1/activity?zoneId=<id>&includeDescendants=true&limit=50`
   - Auth: standard bearer / API token.
   - Response: `{ items: ActivityItem[] }`
   - Returns items where `item.zoneId === zoneId` OR `item.zoneId === null` (global) OR `item.zoneId ∈ descendants(zoneId)` when `includeDescendants=true` (default true).

4. **WebSocket topic**
   - New WS topic `"activity"` in the subscription system.
   - Pushes `{ type: "activity.added", item: ActivityItem }`.

### Frontend

5. **ActivityPanel component** (`ui/src/components/zones/ActivityPanel.tsx`)
   - BEM `.activity__*` classes per [design-system/components/activity-item.md](../../design-system/components/activity-item.md).
   - Renders the 4 icon variants (recipe / mode / motion / neutral) + alarm (red).
   - Hour-bucket grouping (`HH:00 → maintenant` for the current bucket, `HH:00` for older).
   - "par X" attribution when `item.source` is present.
   - Subtitle "dernière heure" + green `● live` pill when WS connected, `○ offline` when not.
   - Mobile variant `.mob__act` rendered when viewport < `md` breakpoint.

6. **useActivity store** (`ui/src/store/useActivity.ts`)
   - Zustand store, capacity 50, in-memory only.
   - At mount: fetches `GET /activity?zoneId=X&includeDescendants=true&limit=50`.
   - WS `activity.added`: prepend, coalesce, cap.
   - Coalescing rule: if the previous item has same `category`, same `source.id`, same `message.template`, and the new item's timestamp is within 500 ms of the previous, merge into a `*.multi` template with `count++` and equipment-name list.
   - One global `setInterval(60_000)` re-computes relative times to avoid per-item re-render storm.

7. **Wire into HomePage**
   - Replace the `TODO spec 101: ActivityPanel slot` comment at [HomePage.tsx:207](../../ui/src/pages/HomePage.tsx#L207) with `<ActivityPanel zoneId={zoneId} />`.
   - Mobile: stacked below `Comportements` (same place; the responsive grid collapses).

8. **i18n**
   - New `ui/src/i18n/{fr,en}/activity.json` with all templates listed in architecture.md §4.

## Out of scope

- Persistence across container restarts.
- Cross-zone Activity feed on the Dashboard.
- Filter UI inside the panel (category toggles, time range).
- Search.
- Per-user activity (who triggered what — `userId` is captured but not displayed in v1).
- Manual user actions beyond order dispatching (e.g. creating/deleting an equipment) — admin churn, kept out of the feed.
- `device.*` events, `zone.data.changed`, `equipment.created/updated/removed`, `settings.*`, `mqtt-*`, `notification-*`, `calendar.*`, `system.update.*` — explicitly excluded.

## Eligible events

| Event type                                             | Activity category | Zone resolution                            | Notes                                                 |
| ------------------------------------------------------ | ----------------- | ------------------------------------------ | ----------------------------------------------------- |
| `recipe.instance.started`                              | `recipe`          | recipe slot `zone` if present, else `null` | "Recette X démarrée"                                  |
| `recipe.instance.stopped`                              | `recipe`          | same                                       | "Recette X arrêtée"                                   |
| `recipe.instance.error`                                | `alarm`           | same                                       | "Recette X en erreur"                                 |
| `equipment.order.executed`                             | `order`           | equipment.zoneId                           | "Appliques → 4 %" + "par X" if source present         |
| `equipment.data.changed` (alias=`motion` ∧ value=true) | `motion`          | equipment.zoneId                           | "Mouvement détecté sur PIR_00". Only the rising edge. |
| `mode.activated`                                       | `mode`            | `null` (global)                            | "Mode Lumière soir activé"                            |
| `mode.deactivated`                                     | `mode`            | `null` (global)                            | Same                                                  |
| `sunlight.changed`                                     | `neutral`         | `null` (global)                            | "Lever du soleil" / "Coucher du soleil · phase Nuit"  |
| `system.alarm.raised`                                  | `alarm`           | `null` (global)                            | "Erreur: <message>"                                   |

Cross-zone recipes (slot `crossZone`) emit `zoneId = null` (global, visible in every zone feed).

## Acceptance criteria

- [x] `ActivityPanel` renders in the zone view (desktop right column, mobile stacked) — smoke test on `/home/<zoneId>` confirmed.
- [x] Bootstrap fetch returns the last hour of items filtered by zone + descendants + global (REST endpoint + buffer logic verified by unit tests + smoke test).
- [x] WebSocket `activity.added` events appear at the top of the feed within 1 s of the engine event (smoke test: 13 items appeared live as recipe + manual orders fired).
- [x] Source attribution displays for orders triggered by a recipe / mode / button / manual API call (smoke test showed "par Motion Light" and "manuel" tags correctly rendered).
- [x] Coalescing collapses 2+ simultaneous orders into a single `*.multi` row with a count (smoke test: "Applique x 1 ×2 → OFF par Motion Light" observed).
- [x] Global events (mode, sunlight, alarm) appear in every zone's feed (`zoneId = null` items always returned by `getItems`, verified in unit tests).
- [x] Time labels follow the polished mockup format (absolute `HH:MM` per item, hour buckets as group labels). Note: spec originally said "relative", aligned with mockup instead.
- [x] Re-render uses one global timer, not per-item (`setInterval(60_000)` in `ActivityPanel`).
- [x] On WS disconnect, the `● live` pill switches to `○ offline` (logic wired to `useWebSocket.status`; pill renders green ● live when connected, observed in smoke test).
- [x] Empty state shows a placeholder ("Aucune activité dans la dernière heure") instead of an empty card.
- [x] `executeOrder()` remains backward-compatible: existing call sites without `source` keep working (529 tests pass).
- [x] All unit tests for `ActivityBuffer` pass (23 scenarios). Coalescing logic for `useActivity` not unit-tested per project convention "no React tests" — covered by the smoke test.
- [x] `npx tsc --noEmit`, `cd ui && npx tsc -b --noEmit`, `npx vitest run`, `npx eslint src/` all green.

## References

- [design-system/components/activity-item.md](../../design-system/components/activity-item.md)
- [design-system/migration.md](../../design-system/migration.md) Phase 7
- [ui-redesign-B-polished.html](../094-ui-redesign/mockups/ui-redesign-B-polished.html) lines 2800-2840 (desktop) and `.mob__act` (mobile)
- [architecture.md](architecture.md)
- [plan.md](plan.md)
