# Spec 201 — A recipe's mode on the cards of the equipments it drives

## Context

The maintainer asked to see on the Dashboard when the stove is in Cocoon. The mode lives in the presence-thermostat recipe (`state.currentMode`, cycle action `set_mode`). Today it shows only on the zone page header (`RecipeModePill`); the Dashboard card of the stove says nothing about it.

The core cannot tell which equipment a recipe's mode applies to. An `equipment` slot does not say whether the recipe reads it or drives it: in presence-thermostat the thermostat and the cocoon buttons have the same shape. Matching every equipment slot would, on production (2026-11-10), put the pill on Poele, PAC and Radiateur Bureau, and also on the buttons Switch Cocoon, Switch Sonos and Switch cocoon bureau, which are inputs.

So the recipe declares it, the way `tile.confirmFrom` (spec 171) names the equipment a tile actuates: the core renders what the recipe declared and infers nothing.

Mockup validated by the maintainer (option B2): https://claude.ai/artifact/8LfNR3XEstTC14kVVKymgg

## Goals

1. A recipe can declare which of its equipment slots its mode applies to.
2. The Dashboard card of such an equipment shows the current mode as a pill, on a computer and on a phone, for every equipment widget type at once.
3. The mode can be changed from there: the computer card's pill, the phone panel's pill (added at the maintainer's request after the spec was approved).

## Non-Goals

- No pill on the equipment page, the zone widget or the recipe tile.
- No inference for recipes that declare nothing: they show no pill.
- The `cocoonTemp` / `nightTemp` filter hard-coded in `recipe-cycle.ts` and `ZoneDetailPage.tsx` stays as it is; its removal is a separate issue.
- No change to the recipe engine, the database, the REST routes or the WebSocket events.

## Functional Requirements

### FR1 — `targets` on a cycle action

`RecipeActionDef` gains an optional `targets?: string[]`: ids of the recipe's `equipment` slots whose equipments the cycle's mode applies to. It is carried to the UI verbatim, like the rest of the action (`RecipeInfo.actions`). An id that does not name an `equipment` slot of the recipe is ignored.

### FR2 — Which pills an equipment card shows

For an equipment E, one pill per (instance, cycle action) such that:

- the instance is enabled;
- the action is `type: "cycle"` and declares `targets`;
- one of its target slots holds E: `params[slot] === E.id`, or the slot is a list and contains E.id;
- `state[action.stateKey]` is a string that matches one of `action.options`.

The pill reads the option's label, in the UI language, through the recipe's i18n pack (`cycleOptionLabel`, as the zone page). Every mode is shown, Éco included. Pills are ordered by instance creation, then by the action's order in the recipe. An equipment held by two target slots of the same instance gets one pill.

### FR3 — Placement (option B2)

The pill sits just under the card's title block (title, zone line, and on a computer the order outcome line of spec 188), aligned left, over the top of the card body. It never moves the title, which stays centred and whole, and never changes the card's height. Several pills sit side by side.

- Computer: in `WidgetCard`, for any card that carries `TileEquipmentContext` (every equipment widget, timed tiles included).
- Phone: in `MobileWidgetCard`, under the label and zone lines.

The colours are the zone page's: Confort in the primary tint, Éco in the success tint, every other value neutral. They move to one shared module so the two surfaces cannot drift.

### FR4 — Live

The pill follows `recipe.instance.state.changed` through the existing `useRecipes` store (the Dashboard already subscribes to `recipes`, spec 169). Disabling the instance removes it.

### FR5 — Recipes declaring it

- presence-thermostat: `set_mode` gains `targets: ["thermostat"]`.
- smart-socket-heating: `set_mode` gains `targets: ["heaters"]`.

Each is a patch release of its package, then a registry bump (spec 089). A core without this spec ignores the field; a recipe without it shows nothing.

### FR6 — Changing the mode

A click on the pill moves to the next mode, the zone page's cycle (`resolveCycle`, same options, same `{ mode }` payload through `useRecipes.sendAction`):

- Computer: the card's pill is a button; the card's own click action ignores it (nested control, spec 098).
- Phone: the card is itself a button and cannot nest another, so its pill only shows. The panel the tap opens (`EquipmentDetailSheet`, every equipment branch) carries the same pills beside its title, as buttons.
- A cycle with fewer than two options left renders a plain pill (a disabled instance shows no pill at all, FR2).
- Every card on a phone, the timed tile included (it uses the computer shell on both widths), shows the pill without the click.
- Recipe actions are admin-only on the API today (`/recipe-instances/:id/actions` is not in the standard user allowlist), as on the zone page and the recipe tile: a standard user's click is refused and the state does not change. Opening it to standard users is a separate issue.

## Acceptance Criteria

- [x] `RecipeActionDef.targets` exists in `src/shared/types.ts` and `ui/src/types.ts`, documented.
- [x] With presence-thermostat declaring `targets: ["thermostat"]`, the Poele card shows « Cocoon » on a computer and on a phone while the instance is in cocoon, and « Éco » in eco.
- [x] The cocoon buttons' cards show no pill.
- [x] A recipe without `targets` puts no pill anywhere.
- [x] A disabled instance, a missing state value or a value outside the options shows no pill.
- [x] The title of « Radiateur Bureau » stays whole and centred with the pill shown.
- [x] Cards keep their height (160/240 px computer, 120 px phone).
- [x] A click on the computer card's pill moves to the next mode without firing the card; the phone panel's pill does the same; the phone card's pill does not react.
- [ ] presence-thermostat and smart-socket-heating released with `targets`, registry bumped.

## Edge Cases

- Instance whose target slot was emptied or whose equipment was deleted: no match, no pill.
- List slot (smart-socket-heating `heaters`): each heater in the list gets the pill.
- Two instances with a mode on the same equipment: two pills, side by side.
- A widget whose body starts at its top-left corner: the pill overlays it; acceptable, as for the order outcome line (no such widget among the equipment types a cycle recipe targets today).
- Edit mode: the drag handle sits in the top-left corner above the title, the pill under it; the pill stays.
- Recipes and instances not loaded yet: no pill until they are.
- Phone, on an equipment whose tap acts directly (a `switch`, so the sockets of smart-socket-heating): the tap toggles the socket and opens no panel, so the mode is changed from the recipe's own tile or the zone page there. Opening a panel instead would change what a tap on a socket does; not done.
- Edit mode on a computer: the pill stays clickable, like the other controls nested in a card (setpoint stepper, power button); only the card's own click action stops.
- The clickable pill sits over the top-left of the card body; on the targeted types (thermostat, heater, switch) that area is empty.

## Docs Delta

| Page (EN and FR)                                             | Change                                                                              |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `docs/user/dashboard.md` + `.fr.md`                          | Equipment widget: the pill showing the mode of the recipe that drives the equipment |
| `docs/technical/recipe-development.md` + `.fr.md`            | New section « The mode on equipment cards (spec 201) »: `targets`, rules, example   |
| `docs/technical/data-model/recipes.md` (EN only, no FR copy) | `RecipeActionDef.targets`                                                           |

Screenshots to retake: none (the Dashboard screenshots in the docs show no recipe-driven equipment).
