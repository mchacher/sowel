# Spec 171 — The recipe tile acts when you tap it

**Status**: implemented
**Scope**: recipe contract + UI (Dashboard)
**Follows**: [spec 169](../169-dashboard-recipe-widget/spec.md)

## Problem

Spec 169 gave a recipe instance a Dashboard tile: icon, title, summary line, countdown, and one pill per declared action. The pill works. The rest of the card does not.

That is not what the card looks like. It is a 240 px square whose own summary line reads _"Prêt — un clic ouvre le Portail pour 15min"_, and the only thing that opens the gate is a 10 px pill at the bottom. Every other widget on that Dashboard actuates when you click it — `WidgetCard` has taken an `onClick` since spec 098, and the mobile card since long before. The recipe tile is the one widget that looks pressable and is not.

## Design principle — the card fires the control it already shows

No new semantics. A tile that renders exactly one control gets a card-wide click that does **what that control does**, and the control stays where it is for anyone who prefers to aim.

Two consequences, both deliberate:

- A tile rendering **two or more** controls gets no card action. Which one would it fire? The pills stay the only way in.
- A tile rendering **no** control — a status-only tile — stays inert, as it is today.

## Goal

Make a tap anywhere on a single-control recipe tile fire that control, and let a recipe whose action moves something physical ask for a confirmation first on mobile.

## In scope

- A card-wide primary action on desktop and mobile, firing the tile's single cycle control.
- `RecipeTileDef.confirm?: boolean` — the recipe declares that its tile action moves something physical.
- `RecipeTileDef.confirmParam?: string` — the id of a boolean slot letting the **user** decide, instance by instance, exactly as a gate equipment carries its own `requireConfirmation` toggle.
- On the **mobile** Dashboard, a confirming tile opens the slide-to-confirm sheet from spec 146 instead of actuating on the tap.
- Suppressing the card action in edit mode, as the equipment widgets already do.

## Out of scope

- The pill's own behaviour. It fires immediately, confirm or not: it is a small, deliberate target, and spec 146 made the same call for gates that need two taps.
- Desktop confirmation. Spec 146 is a mobile guard against a pocket tap; a mouse click is deliberate.
- New action types. `cycle` is still the only one, so "the single control" is still a single cycle.
- Anything about equipment or zone widgets.

## Functional rules

1. **FR-1 — One control, one card action.** When a tile renders exactly one control and the instance is enabled, a click anywhere on the card fires that control's cycle — the same `POST /api/v1/recipe-instances/:id/actions` the pill sends, with the same next value.

2. **FR-2 — The control keeps its own click.** A click that starts or lands on a nested control fires that control alone, never both. This is already `WidgetCard`'s rule; the mobile tile now applies the same one.

3. **FR-3 — No control, no card action.** Zero controls (a status-only tile, a state that carries no cycle key, an instance whose recipe declares no action) or two-and-more controls: the card is inert, exactly as today.

4. **FR-4 — A disabled instance never acts.** It already renders greyed with its controls suppressed (spec 169 FR-6); the card action goes with them.

5. **FR-5 — Edit mode never acts.** While the Dashboard is being rearranged, the card action is suppressed on both surfaces — the rule `getMobileClickAction` already follows for equipment widgets.

6. **FR-6 — `confirm` declares a physical action.** A recipe may return `tile.confirm: true`. On mobile, the card action then opens a slide-to-confirm sheet naming the position it is about to switch to; completing the slide fires the cycle, cancelling fires nothing. On desktop the card fires directly.

7. **FR-7 — The user has the last word.** A recipe may name a boolean slot in `tile.confirmParam`. When the instance carries a value for it, that value decides — `true` asks even if the package declared nothing, `false` skips even if the package declared `confirm`. `confirm` remains the default for an instance that has never been given one, so an instance created before the recipe grew the slot keeps its guard.

   The confirmation is a property of _this installation_, not of the package: a gate on a busy street and a gate in a private courtyard do not want the same answer, and spec 146 already gave that choice to whoever owns the equipment.

8. **FR-8 — An older core ignores both.** They are two more optional fields on a declaration older cores already ignore in full. A recipe declaring them runs unchanged on 1.64.x, where the tile keeps its pill-only behaviour.

## Acceptance criteria

- [x] A tap on the body of a single-control tile sends the same action as its pill.
- [x] A tap on the pill sends exactly one action, not two.
- [x] A tile with two controls, no control, or a disabled instance sends nothing when the body is tapped.
- [x] In edit mode, tapping the body sends nothing on either surface.
- [x] With `tile.confirm`, a mobile tap opens the confirm sheet; completing the slide sends the action, dismissing sends nothing.
- [x] With `tile.confirm`, a desktop click sends the action directly.
- [x] With `tile.confirmParam` answered `false`, a mobile tap acts without a sheet; answered `true` on a recipe declaring no `confirm`, it asks.
- [x] With `tile.confirmParam` unanswered, the package's `confirm` still decides.
- [x] The pill fires immediately on both surfaces, `confirm` or not.

## Edge cases

| Case                                                | Behaviour                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Action fired twice by an impatient double-tap       | The second is dropped while the first is in flight, as the pill already does with its `sending` guard. |
| `tile.confirm` on a tile with no control            | Nothing to confirm, nothing to fire. No sheet.                                                         |
| Slide completed after the instance went disabled    | The sheet closes and the store call is skipped — the tile re-renders greyed from the WebSocket event.  |
| Drag released off a control, click landing on card  | Ignored: the pointerdown bookkeeping in `WidgetCard` already covers it, and the mobile shell now too.  |
| Instance predates the slot the recipe now names     | No value in `params` is not a "no": the package's `confirm` decides (FR-7).                            |
| Param carries `"true"` / `"false"` as strings       | Read as booleans. A boolean slot stores a real boolean, but a hand-written param may not.              |
| Recipe declares `confirm` on a core older than 1.65 | Both fields ignored, tile unchanged (FR-8).                                                            |
