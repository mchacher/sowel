# Architecture — Spec 171

## Contract

`RecipeTileDef` gains one optional boolean:

```ts
export interface RecipeTileDef {
  icon?: string;
  summaryKey?: string;
  countdownKey?: string;
  actions?: string[];
  /** Firing this tile moves something physical → confirm on mobile. */
  confirm?: boolean;
  /** Id of a boolean slot letting the user overrule that, per instance. */
  confirmParam?: string;
}
```

Declared in `src/shared/types.ts` and mirrored in `ui/src/types.ts`, as the other four are. It travels the same road: `RecipeManager.registerExternal` already copies `tile` wholesale into `RecipeInfo`, so no backend code changes — the field arrives in `GET /api/v1/recipes` for free. No migration, no API change, no new event.

## Where the click logic lives

Three extractions, no new mechanism.

### 1. `resolveCycle` — one definition of "the next position"

`ModeCyclePill` computed the option list, the current position and the next one inline. The card now needs the same three, and two copies of that arithmetic would drift.

```
ui/src/components/recipes/recipe-cycle.ts
  export function resolveCycle(instance, action): { options, value, current, next } | null
  export function cycleOptionLabel(recipe, action, option, lang, t): string
```

Its own module rather than a couple more exports on `recipe-form-fields.tsx`: the
`react-refresh/only-export-components` rule refuses non-component exports from a file of
components, and it is right — the pill and the tile both import a helper, not a sibling.

`resolveCycle` returns `null` in exactly the cases where the pill renders nothing: instance disabled, state key absent, fewer than two usable options. That null **is** the "no card action" signal — the card and the pill cannot disagree about whether there is something to fire, because they ask the same function.

### 2. `useCardPrimaryAction` — one definition of "a click on the card"

`WidgetCard` carried the nested-control guard (a `CONTROL_SELECTOR` closest() check, plus pointerdown bookkeeping for a slider drag released off its track). The mobile recipe shell needs the identical guard, and re-typing it is how the slider bug comes back.

```
ui/src/components/dashboard/card-primary-action.ts
  export function useCardPrimaryAction(onClick?): { onPointerDown?, onClick? }
```

`WidgetCard` now spreads it; `RecipeTile`'s mobile shell spreads it too.

### 3. `ConfirmActionSheet` — presentational, with a gate wrapper

The sheet was equipment-shaped: it took an `EquipmentWithDetails`, read a `gate_state` binding and hardcoded the gate wording. A recipe tile has no equipment.

```
ui/src/components/dashboard/ConfirmActionSheet.tsx
  export function ConfirmActionSheet({ title, subtitle, slideLabel, confirmedLabel, onConfirm, onClose })  // generic
  export function GateConfirmSheet({ equipment, zoneName, onConfirm, onClose })                            // spec 146 caller
```

`WidgetGrid` swaps its import to `GateConfirmSheet` and is otherwise untouched: same props, same behaviour, same 500 ms confirmed-state delay before dismissal.

### 4. `tileNeedsConfirm` — who decides

```
ui/src/components/dashboard/recipe-tile-confirm.ts
  export function tileNeedsConfirm(tile, params): boolean
```

The instance parameter first (`true` / `"true"` → ask, `false` / `"false"` → do not), the package's
`confirm` when the user never answered. Absent, `null` and `""` are all "never answered": an instance
created before the recipe grew the slot must not lose its guard to an upgrade.

It reads `instance.params`, not instance state, because this is a _setting_, not a state — the same
place `resolveCycle` already reads `cocoonTemp` from. Pure and React-free, like `gateNeedsConfirm`
(spec 146) sitting next to it.

## RecipeTile

```
actions = declared controls (unchanged)
cycle   = actions.length === 1 ? resolveCycle(instance, actions[0]) : null
fire()  = sendAction(instance.id, action.id, { mode: cycle.next.value }), guarded by `sending`
primary = !cycle || editMode          → undefined      (FR-3, FR-4, FR-5)
          isMobile && needs confirm   → open the sheet (FR-6, FR-7)
          otherwise                   → fire
```

Desktop passes `primary` to `WidgetCard`'s existing `onClick`. Mobile passes it through `useCardPrimaryAction` on the shell `div` — still a `div`, not a `button`: the tile carries its own buttons, and nesting them is invalid HTML that breaks keyboard navigation (the reason spec 169 wrote its own shell instead of reusing `MobileWidgetCard`).

The `sending` and `confirming` state hooks sit above the "recipe gone" early return, where the rules of hooks require them.

## i18n

Three keys, EN + FR:

| Key                                   | EN                      | FR                         |
| ------------------------------------- | ----------------------- | -------------------------- |
| `dashboard.recipeTile.confirmTitle`   | `Switch to "{{mode}}"?` | `Passer en « {{mode}} » ?` |
| `dashboard.recipeTile.slideToConfirm` | `Slide to confirm`      | `Glisser pour confirmer`   |
| `dashboard.recipeTile.confirmed`      | `Sent`                  | `Envoyé`                   |

The sheet's subtitle is built, not translated: the tile title and the instance's own summary line, joined by `·`. Both are already localized by whoever wrote them.

## Files

| File                                                 | Change                                      |
| ---------------------------------------------------- | ------------------------------------------- |
| `src/shared/types.ts`                                | `RecipeTileDef.confirm` + `confirmParam`    |
| `ui/src/types.ts`                                    | idem                                        |
| `ui/src/components/recipes/recipe-cycle.ts`          | new — `resolveCycle` + `cycleOptionLabel`   |
| `ui/src/components/recipes/recipe-form-fields.tsx`   | the pill consumes them                      |
| `ui/src/components/dashboard/card-primary-action.ts` | new — the nested-control guard              |
| `ui/src/components/dashboard/recipe-tile-confirm.ts` | new — declaration vs. the user's own answer |
| `ui/src/components/dashboard/WidgetCard.tsx`         | uses the extracted guard                    |
| `ui/src/components/dashboard/ConfirmActionSheet.tsx` | presentational + `GateConfirmSheet` wrapper |
| `ui/src/components/dashboard/WidgetGrid.tsx`         | imports `GateConfirmSheet`                  |
| `ui/src/components/dashboard/RecipeTile.tsx`         | primary action, confirm sheet               |
| `ui/src/i18n/locales/{en,fr}.json`                   | three keys                                  |
| `docs/technical/recipe-development{,.fr}.md`         | document `confirm` and the card action      |
| `docs/user/dashboard{,.fr}.md`                       | what a tap on a recipe tile does            |
