# Spec 146 — Architecture

## Overview

`requireConfirmation` is a plain per-equipment boolean, modeled exactly like the
existing optional `energyProfile?` field (spec 140): a nullable SQLite column, a
manager mapping both ways, an entry in the update body schema, and no new route.
Consumption is entirely on the mobile dashboard client.

```
Admin toggles on detail page
  → PUT /equipments/:id { requireConfirmation: true }
    → EquipmentManager.update → UPDATE equipments SET require_confirmation = 1
      → equipment.data.changed / equipment payload → WS → clients
        → mobile WidgetGrid: guarded gate tap opens SlideToConfirm sheet
          → slide complete → executeOrder(gate, "command", null) (normal path)
```

## Data model

### Type (`src/shared/types.ts`)

Add to `Equipment` (after `energyProfile?`):

```ts
export interface Equipment {
  // ...
  energyProfile?: EnergyLoadProfile;
  /** Spec 146 — opt-in confirmation before actuating on the mobile dashboard.
   *  Present/true only when an admin enabled it. Gate equipments only in v1. */
  requireConfirmation?: boolean;
}
```

`UpdateEquipmentInput` (`equipment-manager.ts`) gains
`requireConfirmation?: boolean;`. `EquipmentWithDetails` (UI `types.ts`) inherits
it through `Equipment`.

### Migration (`migrations/018_equipment_require_confirmation.sql`)

```sql
-- Spec 146 — optional per-equipment confirmation before actuating (gate v1).
ALTER TABLE equipments ADD COLUMN require_confirmation INTEGER NOT NULL DEFAULT 0;
```

Boolean stored as `0/1`. `NOT NULL DEFAULT 0` makes every existing row
unguarded, matching "off by default".

### Manager mapping (`src/equipments/equipment-manager.ts`)

- **Row type** (`EquipmentRow`, ~line 1279): add `require_confirmation: number;`.
- **row → Equipment** (`rowToEquipment`, ~line 1374): add
  `requireConfirmation: row.require_confirmation === 1`.
- **`updateEquipment` prepared statement** (~line 184): add
  `require_confirmation = @requireConfirmation` and, in the update method
  (~line 460), resolve
  `requireConfirmation: input.requireConfirmation !== undefined ? (input.requireConfirmation ? 1 : 0) : existing.require_confirmation`.
- **create/insert**: `INSERT` uses `DEFAULT 0`; create input does not expose the
  flag (it is enabled after creation from the detail page), so the insert
  statement is unchanged.

Follow the exact shape of the `energyProfile` handling already in the file — this
is a strictly simpler (boolean, no JSON) variant.

## API (`src/api/routes/equipments.ts`)

- `updateEquipmentBodySchema` (~line 32): add
  `requireConfirmation: { type: "boolean" }` to `properties`. Fastify then
  rejects a non-boolean with 400 before the handler.
- The `PUT /equipments/:id` handler (~line 134) already forwards known optional
  fields to `equipmentManager.update`; thread `requireConfirmation` through the
  same way `energyProfile` is threaded.
- No new route, no new event type. The updated equipment is broadcast through the
  existing equipment-changed path, so the payload carries the new field.

## Frontend

### 1. Enable toggle — equipment detail page

New component `ui/src/components/equipments/GateConfirmationPanel.tsx`, modeled on
`EnergyManagementPanel` (card + header + right-aligned toggle + hint). It renders
a single switch bound to `equipment.requireConfirmation`, persisting via
`updateEquipment(equipment.id, { requireConfirmation: next })` and calling
`onUpdated()`.

Mounted in `EquipmentDetailPage.tsx` next to the gate controls block, gated on
`isGate && isAdmin`:

```tsx
{
  isGate && isAdmin && (
    <GateConfirmationPanel equipment={equipment} onUpdated={() => void fetchEquipments()} />
  );
}
```

### 2. Slide-to-confirm sheet — mobile dashboard

Two new UI pieces under `ui/src/components/dashboard/`:

- `SlideToConfirm.tsx` — a controlled slide track (pointer/touch drag). Props:
  `label`, `onConfirm()`. Fires `onConfirm` when the knob reaches the end; resets
  on partial release. Styling uses design tokens (amber `warning` knob → green
  `success` on completion), matching the validated mockup (variant B).
- `ConfirmActionSheet.tsx` — a minimal bottom sheet (scrim + short panel), title
  ("Ouvrir {name} ?") + subtitle (zone · current state) + `<SlideToConfirm>` +
  "Annuler". Reuses the sheet slide-up pattern of `WidgetDetailSheet`.

### 3. Wiring in `WidgetGrid.tsx`

- Add a `confirmWidgetId` state alongside the existing `detailWidgetId`, and
  render `<ConfirmActionSheet>` for it (same place `EquipmentDetailSheet` is
  rendered). On confirm it calls `onExecuteOrder(equipmentId, commandAlias, null)`.
- `getMobileClickAction` gains an `onConfirmAction?: () => void` parameter. In the
  `type === "gate"` single-action branch:

```ts
if (commandBinding && enumValues.length <= 1) {
  if (equipment.requireConfirmation && onConfirmAction) return onConfirmAction;
  return () => {
    onExecuteOrder(equipment.id, commandBinding.alias, null);
  };
}
```

Because this lives in the `isMobile` render path only, desktop is untouched.

- Extract the guard decision into a pure, exported helper so it is unit-testable
  without React:

```ts
// ui/src/components/dashboard/gate-confirm.ts
export function gateNeedsConfirm(equipment: EquipmentWithDetails): boolean {
  if (equipment.type !== "gate" || !equipment.requireConfirmation) return false;
  const cmd = findOrderByCategory(equipment.orderBindings, ["gate_trigger"], ["command"]);
  return !!cmd && (cmd.enumValues?.length ?? 0) <= 1; // single-action only in v1
}
```

`getMobileClickAction` uses `gateNeedsConfirm(equipment)` for the branch above.

### 4. Shield indicator

In the mobile tile (`MobileWidgetCard`), when `gateNeedsConfirm(equipment)` is
true, render a tiny muted shield in the top-right corner with a tooltip
(`t("controls.gate.confirmProtected")`).

## i18n (`ui/src/i18n/locales/{en,fr}.json`)

New keys:

- `equipments.gateConfirm.title`, `.enable`, `.hint`
- `controls.gate.confirmSheetTitle` ("Open {name}?"), `.confirmSheetSubtitle`
- `controls.gate.slideToOpen`, `.actuated`
- `controls.gate.confirmProtected` (shield tooltip)
- reuse `common.cancel`

## Files touched

| File                                                     | Change                                     |
| -------------------------------------------------------- | ------------------------------------------ |
| `src/shared/types.ts`                                    | `requireConfirmation?` on `Equipment`      |
| `migrations/018_equipment_require_confirmation.sql`      | new column                                 |
| `src/equipments/equipment-manager.ts`                    | input type, row type, mapping, update stmt |
| `src/api/routes/equipments.ts`                           | body schema + handler passthrough          |
| `ui/src/types.ts`                                        | mirror field if UI type is standalone      |
| `ui/src/components/equipments/GateConfirmationPanel.tsx` | new toggle card                            |
| `ui/src/pages/EquipmentDetailPage.tsx`                   | mount panel (gate + admin)                 |
| `ui/src/components/dashboard/SlideToConfirm.tsx`         | new control                                |
| `ui/src/components/dashboard/ConfirmActionSheet.tsx`     | new minimal sheet                          |
| `ui/src/components/dashboard/gate-confirm.ts`            | pure guard helper                          |
| `ui/src/components/dashboard/WidgetGrid.tsx`             | confirm state + wiring                     |
| `ui/src/components/dashboard/MobileWidgetCard.tsx`       | shield indicator                           |
| `ui/src/i18n/locales/en.json`, `fr.json`                 | strings                                    |
| `src/equipments/equipment-manager.test.ts`               | persistence round-trip                     |
| `ui/src/components/dashboard/gate-confirm.test.ts`       | guard-decision cases                       |
