# Spec 214 — Plan

## Slices

### Slice A — Re-apply the generic UI fixes from PR #1271

- [ ] `ui/src/lib/appliance.ts` (+ test) and the four appliance surfaces, strings.
- [ ] History chart enum cardinality (+ test), `AnalyseView`, `tooltip-format`, no virtual toggle.

### Slice B — Recipe outputs in the core

- [ ] Types: `RecipePublishDef`, `publishes`, `RecipeEquipmentDataHelpers`.
- [ ] `recipe-outputs.ts` + tests.
- [ ] EquipmentManager: check, attach, detach, publish, virtual binding; tests.
- [ ] RecipeManager: declaration check, targets, lifecycle, `ctx.helpers.equipmentData`; tests.
- [ ] HistoryWriter and `/history/bindings`: `virtual:recipe:` prefix; tests.

### Slice C — Docs

- [ ] Docs delta of the spec, EN and FR.

## Test Plan

### Modules to test

- `src/equipments/recipe-outputs.ts`
- `src/equipments/equipment-manager.ts`
- `src/recipes/engine/recipe-manager.ts`
- `src/history/history-writer.ts`

### Scenarios

| Module            | Scenario                                                                                        | Expected                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| recipe-outputs    | `checkValue`: enum in / out of `enumValues`, NaN number, boolean, `null`                        | ok / denied / denied / ok / ok                                 |
| recipe-outputs    | `set` the same value twice                                                                      | `changed` true then false                                      |
| recipe-outputs    | `detach` returns the equipments touched                                                         | ids of every target, store empty for the instance              |
| equipment-manager | attached output, no value yet                                                                   | virtual binding first in `dataBindings`, `null`, declared meta |
| equipment-manager | publish a declared enum                                                                         | one `equipment.data.changed` with value and previous           |
| equipment-manager | publish an undeclared alias / on another equipment / outside `enumValues`                       | denied, no event, `warn` log                                   |
| equipment-manager | device binding with the same alias added after attach                                           | no virtual binding; publish denied                             |
| equipment-manager | `checkPublishable` over a device-bound alias                                                    | throws 400 naming equipment and alias                          |
| equipment-manager | `checkPublishable` over an alias another instance publishes                                     | throws 400 naming the other instance                           |
| equipment-manager | detach                                                                                          | binding gone, `equipment.updated` per equipment                |
| equipment-manager | `list` slot with two equipments                                                                 | one virtual binding on each                                    |
| equipment-manager | appliance with numeric power, no state, no recipe                                               | no virtual `state`                                             |
| recipe-manager    | `registerExternal` with a `publishes` on a non-equipment slot / enum without values / duplicate | throws, recipe not registered                                  |
| recipe-manager    | create an instance whose target alias is device-bound                                           | `RecipeError` 400                                              |
| recipe-manager    | instance publishes in `start`                                                                   | value visible on the equipment, event emitted                  |
| recipe-manager    | disable, delete, update to another equipment                                                    | binding removed / moved                                        |
| recipe-manager    | `start` throws after attach                                                                     | outputs detached                                               |
| recipe-manager    | validation context `publish`                                                                    | denied, nothing stored                                         |
| history-writer    | `virtual:recipe:` enum change                                                                   | point written with index                                       |
| history-writer    | gate virtual `state` change                                                                     | not written (retro-compat)                                     |

The core scenario (a publish reaches the equipment as a binding and an event) is checked failing
once on purpose by not emitting in `publishRecipeData`.

## Validation Plan

- `npm run validate`, then the four docs and spec checks.
- Local backend on a scratch DB with a stub recipe package publishing a `state` on an
  `appliance`: the binding on the equipment page, the history row, a `state-watch` on it.

## Production deployment

Nothing in production uses this until the `appliance-cycle` recipe exists. After both
ship, in this order (FR2 refuses an instance over a device-bound `state`):

1. At the cut, remove the SmartThings `state` binding of Lave-linge.
2. Install the recipe and create its instance on Lave-linge.
3. Point the "lessive terminée" `state-watch` at `finished`.

The SmartThings state and the derived one cannot run side by side under the same alias; a
comparison before the cut stays in the recipe's own log.
