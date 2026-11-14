# Architecture — Spec 208

## Flow

```
equipments.family (SQLite, migration 045, NULL by default)
  → EquipmentManager.update / rowToEquipment  (Equipment.family)
    → PUT /api/v1/equipments/:id  (validates: enum, switch only)
      → UI store (EquipmentWithDetails.family)
        → lib/equipment-family.ts
            sectionOf(eq)  → ZoneEquipmentsView sections (FR1 order)
            familyOf(eq)   → SliceHeader tone, tile classes
        → components/equipments/equipment-running.ts
            isRunning(eq)  → tile at rest or filled
```

No event, no WebSocket change: `family` rides on the equipment payload like the other equipment fields
(`equipment.updated`).

## Components

### New: `ui/src/lib/equipment-family.ts`

- `EquipmentFamily` (re-exported from `types.ts`) and `EQUIPMENT_FAMILIES`.
- `SECTIONS`: ordered list of `{ id, labelKey, family | null, types }` (FR1), plus the trailing `other`.
- `familyOf(eq)`: the switch's `family` when set, else the type's family, else `null`.
- `sectionOf(eq)`: a family's section, or the type's neutral section, or `other`.
- `FAMILY_CLASSES`: literal Tailwind class strings per family (`tile`, `tileRunning`, `title`, `chip`), so the
  Tailwind scanner sees every class. Neutral: `NEUTRAL_TILE`.
- `tileClasses(family, running)`.

### New: `ui/src/components/equipments/equipment-running.ts`

`isRunning(eq)`: FR4 table, from the same helpers the controls use (`findDataByCategory`,
`thermostatPowerStateBinding`, `evChargerStateOf`, `electricVehicleStateOf`, the VMC speed binding).

### New: `ui/src/components/equipments/FamilyPanel.tsx`

ConfigRow on a switch's equipment page (admin): a select « None (Plugs) » + the six families; saves through
`updateEquipment(id, { family })`.

### Tokens

`design-system/tokens.css`: `--fam-<family>-50`, `-ink`, `-fill`, `-on` in both theme blocks. Lighting points
at the amber tokens (`var(--a-…)` would break the contrast test parser, so the hex values are repeated with a
comment). `ui/src/index.css` `@theme`: `--color-fam-<family>-{50,ink,fill,on}`. The old `--sensor-*` and
`--media-*` category tints lose their last user and are removed; `--shutter-*` stays (shutter state pill and
slider).

## Files changed

| Domain     | File                                                | Change                                           |
| ---------- | --------------------------------------------------- | ------------------------------------------------ |
| Types      | `src/shared/types.ts`, `ui/src/types.ts`            | `EquipmentFamily`, `Equipment.family`            |
| Constants  | `src/shared/constants.ts`                           | `EQUIPMENT_FAMILIES`                             |
| DB         | `migrations/045_equipment_family.sql`               | `ALTER TABLE equipments ADD COLUMN family TEXT`  |
| Equipments | `src/equipments/equipment-manager.ts`               | update input, SQL, row mapping                   |
| API        | `src/api/routes/equipments.ts`                      | schema enum, switch-only validation              |
| UI lib     | `ui/src/lib/equipment-family.ts`                    | new                                              |
| UI         | `ui/src/components/equipments/equipment-running.ts` | new                                              |
| UI         | `ui/src/components/equipments/useEquipmentState.ts` | `iconColor` from family + running                |
| UI         | `ui/src/components/home/CompactEquipmentCard.tsx`   | `TYPE_TINTS` replaced by family tiles            |
| UI         | `ui/src/components/home/ZoneEquipmentsView.tsx`     | sections from `SECTIONS`, header tone            |
| UI         | `ui/src/components/home/Panel.tsx`                  | `SliceHeader` `tone` prop                        |
| UI         | `ui/src/pages/EquipmentDetailPage.tsx`              | header tile, FamilyPanel mount                   |
| UI         | `ui/src/components/equipments/FamilyPanel.tsx`      | new                                              |
| UI         | `ui/src/components/layout/AppLayout.tsx`            | MobileNav / MobileNavLink (FR7)                  |
| UI         | `ui/src/api/equipments.ts`                          | `family` in the update payload                   |
| i18n       | `ui/src/i18n/locales/{fr,en}.json`                  | family and section keys, type labels, panel copy |
| Tokens     | `design-system/tokens.css`, `ui/src/index.css`      | family tokens, old tints removed                 |
