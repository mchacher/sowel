# Spec 214 — Architecture

## Flow diagram

```
RecipeLoader → RecipeManager.registerExternal(definition)
                 checks definition.publishes (FR1.2), carries it into RecipeInfo

RecipeManager.createInstance / updateInstance / enableInstance / init
  → resolve each declaration's slot to equipment ids (params[slot], one or a list)
  → EquipmentManager.checkPublishable(instanceId, targets)       FR2 → 400 / logged refusal
  → startInstance
       → EquipmentManager.attachRecipeOutputs(instanceId, recipeName, targets)
            emits equipment.updated per equipment                 FR4.4
       → recipe.start(params, ctx)
            ctx.helpers.equipmentData.publish(eqId, alias, value)
              → EquipmentManager.publishRecipeData(instanceId, eqId, alias, value)
                   checks FR3.2, stores, emits equipment.data.changed (FR3.3)

stopInstance
  → recipe.stop()
  → EquipmentManager.detachRecipeOutputs(instanceId)              FR4.3
       emits equipment.updated per equipment

EquipmentManager.getDataBindingsWithValues(eqId)
  → unshift one virtual binding per attached output whose alias no device binding carries

equipment.data.changed → HistoryWriter (virtual:recipe:* historized) → InfluxDB
                       → WebSocket → UI stores → surfaces
                       → other recipes (state-watch …)
```

## Components

### New: `src/equipments/recipe-outputs.ts`

The store of what running instances publish, owned by the EquipmentManager (no SQLite).

```ts
interface RecipeOutput {
  instanceId: string;
  recipeName: string;
  equipmentId: string;
  def: RecipePublishDef;
  value: unknown; // null until the first publish
  lastUpdated: string | null;
  lastChanged: string | null;
}
```

- `attach(instanceId, recipeName, targets: { equipmentId, def }[])`, `detach(instanceId)`:
  returns the equipment ids touched, for the caller's `equipment.updated`.
- `forEquipment(equipmentId)`: outputs of that equipment.
- `owner(equipmentId, alias)`: the instance publishing it, if any.
- `set(instanceId, equipmentId, alias, value)`: `{ changed, previous }` or a denial reason.
- `checkValue(def, value)`: pure, FR3.2 type rules (`null` always valid).

### Changed: `src/equipments/equipment-manager.ts`

- Holds a `RecipeOutputs`.
- `checkPublishable(instanceId, targets)`: FR2 — throws `EquipmentError(…, 400)` naming the
  equipment, the alias and the other instance.
- `attachRecipeOutputs` / `detachRecipeOutputs` / `publishRecipeData` (FR3, FR4); the device-bound
  alias check of FR4.2 is made on each publish against the raw rows.
- `getDataBindingsWithValues`: after the gate and cover blocks, one virtual binding per output of
  the equipment whose alias no device binding carries
  (`buildRecipeOutputBinding`, id `virtual:recipe:<instanceId>:<alias>`).

### Changed: `src/recipes/engine/recipe-manager.ts`

- `registerExternal`: validate `definition.publishes` (FR1.2), throw on violation (the loader
  already logs and skips a package whose registration throws); carry `publishes` into `info`.
- `resolvePublishTargets(info, params)`: declarations × equipment ids of their slot.
- `createInstance` / `updateInstance`: `checkPublishable` after `recipe.validate`, `RecipeError`
  400 with its message.
- `startInstance`: `checkPublishable` (enable and boot paths), then `attachRecipeOutputs` before
  `recipe.start`; on a throw from `start`, `detachRecipeOutputs` (like the capacity release).
- `stopInstance`: `detachRecipeOutputs` after `recipe.stop()`.
- `buildContext`: `helpers.equipmentData = { publish }`, bound to the instance id. The `temp`
  validation context gets a `publish` that denies.

### Changed: `src/shared/types.ts` (and `ui/src/types.ts` for `RecipeInfo`)

- `RecipePublishDef`; `publishes?: RecipePublishDef[]` on `RecipeDefinition` and `RecipeInfo`.
- `RecipeEquipmentDataHelpers { publish(equipmentId, alias, value): { ok: true } | { ok: false;
reason: string } }`; `RecipeHelpers.equipmentData`.
- `HistoryBindingState` (UI) gains `virtual?: boolean` and `enumValues?: string[]`.

### Changed: `src/history/history-writer.ts`, `src/api/routes/history.ts`

- HistoryWriter skips virtual bindings except `virtual:recipe:*` (constant
  `RECIPE_OUTPUT_BINDING_PREFIX` in `recipe-outputs.ts`), historized always.
- `/history/bindings`: keep `virtual:recipe:*` rows with `virtual: true`, `effectiveOn: true`;
  `enumValues` on every enum row. Gate and cover virtual bindings stay filtered out.

### Changed: UI (re-applied from PR #1271, FR6 and FR5.3)

- New `ui/src/lib/appliance.ts` (+ test): `applianceState`, `applianceIsOn`,
  `applianceStateLabelKey`.
- `AppliancePanel.tsx`, `MobileWidgetCard.tsx`, `EquipmentWidget.tsx`, `CompactEquipmentCard.tsx`:
  use it; `appliance.state.ready` / `.finished` strings.
- `history-utils.ts` (+ test): `familyOf` / `isBooleanCategory` / `axisForCategory` take
  `enumValues`; `AnalyseView.tsx` and `tooltip-format.ts` pass them.
- `EquipmentDetailPage.tsx` history row: no toggle on a `virtual` row (`history.derived`,
  "Published by a recipe, always on").

## Files changed

| File                                                                  | Change                               |
| --------------------------------------------------------------------- | ------------------------------------ |
| `src/equipments/recipe-outputs.ts` (+ test)                           | new: store, value checks             |
| `src/equipments/equipment-manager.ts` (+ test)                        | check, attach, detach, publish, bind |
| `src/recipes/engine/recipe-manager.ts` (+ test)                       | declaration check, lifecycle, helper |
| `src/shared/types.ts`, `ui/src/types.ts`                              | publish types, history row fields    |
| `src/history/history-writer.ts` (+ test), `src/api/routes/history.ts` | virtual recipe series                |
| `ui/src/lib/appliance.ts` (+ test) and the four appliance surfaces    | on/off from state or power           |
| `ui/src/components/history/*`, `EquipmentDetailPage.tsx`              | enum cardinality, no virtual toggle  |
| `ui/src/i18n/locales/{en,fr}.json`                                    | strings                              |
| docs (see spec Docs Delta)                                            | EN + FR                              |
