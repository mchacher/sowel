# Spec 169 — A recipe declares a Dashboard tile

**Issue**: [#852](https://github.com/mchacher/sowel/issues/852)
**Status**: implemented
**Scope**: recipe contract + core (schema, API) + UI

## Problem

A recipe instance is reachable only from its zone page. Several recipes carry a **live, actionable state** — a countdown, a one-line status, a mode pill — and the Dashboard, the screen built for "at a glance", cannot show any of it.

The trigger is a recipe that opens a gate for a delivery and closes it again on its own after a chosen window. The opening is not what matters — a remote does that. What matters is _seeing that the gate will close by itself, and when_. That state exists and renders correctly on the recipe row; it simply cannot be pinned next to the gate widget it is about.

## Design principle — the package declares, the core does not offer

The point is **not** to make every recipe instance pinnable. A recipe knows whether it has anything worth watching at a glance; most do not, and a Dashboard picker listing every instance in the house would be noise.

So the declaration lives in the recipe package, next to `slots` and `actions`:

> A recipe without `tile` is never pinnable, never listed, and gains no surface it did not ask for.

This also keeps the core honest: it renders what a recipe declared, it does not decide what a recipe means.

## Goal

Let a recipe package opt into a Dashboard tile, and let a user pin an instance of such a recipe next to the equipment widgets it acts on.

## In scope

- `RecipeDefinition.tile?: RecipeTileDef` in the recipe contract, carried into `RecipeInfo`.
- A third widget type, `recipe`, referencing a recipe instance.
- A `RecipeTile` rendering, on desktop and mobile: icon, title, the declared summary line, the declared countdown, and the declared actions as controls.
- Refusing to pin an instance whose recipe declares no tile.

## Out of scope

- Any new _kind_ of rendering. The tile shows what `RecipeInstanceRow` already shows; nothing is invented, `CountdownTimer` and `ModeCyclePill` are extracted and reused.
- New action types. `cycle` is the only `RecipeActionDef.type` that exists; the tile exposes those and nothing else.
- Editing instance parameters from the tile. Configuration stays on the zone page.
- Migrating the tile onto the spec 149 presentation resolver (see "Open question").
- Zone or equipment widgets — untouched.

## Functional rules

1. **FR-1 — Declaration.** A recipe package may return `tile` from `createRecipe()`. `RecipeManager.registerExternal` copies it into `RecipeInfo`, exactly as it already does for `actions`. `GET /api/v1/recipes` therefore carries it, and the UI needs no second call to know which recipes are pinnable.

2. **FR-2 — Eligibility.** The "Recipe" tab of the widget picker lists **only** instances whose recipe declares a tile. `POST /api/v1/dashboard/widgets` refuses any other instance with `400 Recipe declares no tile`.

3. **FR-3 — What the tile renders.** In order: the icon (`tile.icon`, else a default), the title (the widget's `label` if the user renamed it, else the recipe's localized name), the summary line read from `state[tile.summaryKey ?? "summary"]`, the countdown read from `state[tile.countdownKey ?? "timerExpiresAt"]`, and one control per action id in `tile.actions`. **Every element is optional**: a key absent from the instance state renders nothing, it does not render an empty slot.

4. **FR-4 — Controls.** A control behaves exactly as its pill does on the recipe row: it cycles to the next option and calls `POST /api/v1/recipe-instances/:id/actions`. Permission is unchanged — any signed-in user may fire a recipe action, as they can today on the zone page. Adding or removing a widget stays admin-only, as for every widget.

5. **FR-5 — Liveness.** The tile updates from the `recipe.instance.state.changed` WebSocket event, which already exists. The countdown ticks client-side, from the ISO deadline.

6. **FR-6 — A disabled instance is shown, not hidden.** A disabled instance renders greyed out with its controls suppressed — the same treatment the recipe row gives it. A user who disabled a recipe should see why their tile went quiet, not watch it vanish.

## Acceptance criteria

- [x] A recipe package that returns `tile` appears in the widget picker's Recipe tab; one that does not, never appears.
- [x] `POST /api/v1/dashboard/widgets` with `type: "recipe"` and a valid instance returns 201; with an unknown instance returns 400; with an instance whose recipe declares no tile returns 400.
- [x] The tile renders summary, countdown and actions when the state carries them, and omits each one cleanly when it does not.
- [x] Clicking a control cycles the mode and the tile reflects the new state without a reload.
- [x] The countdown ticks down each second and disappears at zero.
- [x] Deleting the recipe instance removes the widget (FK cascade); no orphan row survives.
- [x] A widget whose recipe stopped declaring a tile renders as unavailable, and the user's other widgets are unaffected.
- [x] Existing equipment and zone widgets render exactly as before; the migration preserves every existing row and both existing foreign keys.

## Edge cases

| Case                                              | Behaviour                                                                                                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Recipe package updated and `tile` removed         | The widget renders "unavailable" with the recipe name. **It is not deleted** — a package update must not silently rewrite a user's Dashboard. |
| Package uninstalled, instances gone               | FK cascade removes the widget, as for a deleted equipment.                                                                                    |
| `tile.actions` names an id absent from `actions`  | That control is skipped. A typo in a package costs a button, not a broken tile.                                                               |
| `tile.icon` names a key outside the tile icon set | Falls back to the default icon.                                                                                                               |
| Instance state has neither summary nor countdown  | The tile shows icon + title alone. Legitimate: a recipe may declare a tile only for its controls.                                             |
| Instance disabled                                 | Greyed, controls suppressed (FR-6).                                                                                                           |
| Countdown deadline in the past                    | Nothing renders — same rule as `CountdownTimer` today.                                                                                        |
| Two widgets on the same instance                  | Allowed. Same as two widgets on one equipment today; no uniqueness constraint is added.                                                       |

## Open question — spec 149

[Spec 149](../149-dashboard-presentation-resolver/spec.md) is migrating widgets onto `resolveWidgetPresentation`, whose descriptor is built from an **equipment**. A recipe tile is not an equipment: its state comes from the instance and its controls are recipe actions.

This spec implements the tile **alongside** the resolver, which is the smaller diff and leaves the mid-migration file alone. Routing it _through_ a widened `WidgetPresentation` is the alternative, and is the maintainer's call on the issue.
