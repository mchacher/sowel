# Spec 146 — Confirmation before a sensitive gate action

## Context

As a Sowel instance is shared with household members, a gate/door widget on the
mobile dashboard is a single tap away from actuating. That single tap is easy to
fire by accident — the reporter (issue #320) opened his front gate while pocketing
his phone, without noticing. On mobile, a gate widget with a single command
executes the order on one tap (`getMobileClickAction` in `WidgetGrid.tsx`), so
there is zero friction between an accidental touch and the gate moving.

This spec adds an **optional, per-equipment confirmation step** on sensitive
openings (gate / garage door). It is **off by default** and enabled by an admin
on the equipment's detail page. When enabled, tapping the gate widget on the
**mobile dashboard** no longer fires the command directly: it opens a minimal
bottom sheet with a **slide-to-confirm** control. Only a deliberate slide
actuates the gate.

Scope is intentionally narrow (issue #320 discussion):

- **Equipment type**: `gate` only. Sowel has no literal "ouvrant" category — the
  `gate` type is the single abstraction that covers all openings. Portail
  battant, portail coulissant, and porte de garage are the same `gate` type,
  differing only by the chosen widget icon (`gate` / `sliding_gate` /
  `garage_door`, all declared `types: ["gate"]` in `widget-icons.ts`). Gating on
  `type === "gate"` therefore covers garage doors too.
- **Surface**: the **mobile dashboard** single-tap path only.
- **Interaction**: a minimal bottom sheet (name + slide-to-confirm), variant "B"
  validated with the reporter/maintainer.

## Goals

- Give admins a per-gate opt-in that prevents accidental one-tap actuation on
  mobile.
- Keep the guard invisible and zero-cost when the option is off (default).
- Reuse Sowel's existing persistence pattern (`energyProfile?` on `Equipment`)
  and the existing `PUT /equipments/:id` route — no new entity, event, or route.

## Non-goals / explicitly out of scope (v1)

- **Desktop and non-dashboard surfaces**: the equipment detail page
  `GateControl`, the desktop dashboard widget, and the mobile `WidgetDetailSheet`
  gate buttons are **unchanged**. Those are either deliberate admin contexts or
  already require more than one tap. The guard targets the one-tap accidental
  vector only, per the reporter's ask ("uniquement au mobile").
- **Multi-action gates on mobile**: a gate exposing several enum commands already
  opens the detail sheet on mobile (two taps, not a one-tap accident), so it is
  not guarded in v1. Documented limitation; can be revisited.
- **Other equipment types** (shutter, light, switch, water valve, ...). The
  reporter narrowed the request to openings ("catégorie ouvrants"), and v1 ships
  `gate` only.
- **Server-side enforcement**: the flag is a UI safety on the mobile client. The
  backend persists and returns it but does not block `executeOrder` — a
  confirmed slide calls the normal order path. (A stray tap never reaches the
  order in the first place, which is the point.)

## User stories

1. As an admin, on a gate equipment's detail page I see a "Confirmation before
   action" card (off by default). I toggle it on; the choice persists and syncs
   to every client via the equipment payload.
2. As a household member on the mobile dashboard, when I tap a guarded gate tile
   nothing actuates: a small sheet slides up asking me to slide to open. I slide
   the knob to the end and the gate actuates; the sheet closes.
3. As the same member, if I tap by accident, the sheet appears but a stray touch
   does not complete the slide, so the gate stays put. Tapping outside or
   "Annuler" dismisses without acting.
4. On desktop or on any non-gate equipment, behavior is exactly as today.

## Acceptance criteria

- [x] `Equipment` carries an optional `requireConfirmation?: boolean`, persisted
      in SQLite, defaulting to off (absent/false) for all existing equipments.
- [x] The flag round-trips through create/update and the REST payload
      (`GET`/`PUT /equipments/:id`) and the WebSocket equipment payload.
- [x] `PUT /equipments/:id` accepts `requireConfirmation: boolean` and rejects a
      non-boolean value with a 400 (schema validation).
- [x] The equipment detail page shows a "Confirmation before action" toggle
      **only** for `type === "gate"` and **only** for admins; toggling persists
      via `updateEquipment`.
- [x] On the mobile dashboard, a **single-action** gate with
      `requireConfirmation === true` opens a minimal slide-to-confirm sheet
      instead of firing the command; a completed slide executes the gate
      `command` order.
- [x] A partial slide (released before the end) resets and does not actuate.
- [x] "Annuler" / tapping the scrim dismisses the sheet without actuating.
- [x] With the flag off (default), the mobile gate tap behaves exactly as today
      (direct actuation), and no sheet appears.
- [x] Desktop dashboard, the detail-page `GateControl`, and all non-gate
      equipments are unchanged.
- [x] A tiny, muted shield indicator marks a guarded gate tile on the dashboard.
- [x] EN + FR i18n strings for the toggle, the sheet, and the shield tooltip.
- [x] Tests: equipment-manager persistence round-trip + the pure guard-decision
      helper (see plan.md test plan).

## Edge cases

- Flag absent in DB (all pre-migration rows) → treated as `false`.
- Gate has no command binding → nothing to guard; tile is not actionable
  regardless (unchanged).
- Multi-action gate with the flag on → v1 ignores the flag on mobile (still opens
  the detail sheet); documented.
- Non-admin viewing a gate detail page → no toggle shown (read path unaffected).
- Flag on but viewed on desktop → inert (no swipe surface); direct control stays.

## Amendment — 2026-11-07, spec 196: every path that actuates the gate asks

The v1 scope above (mobile dashboard tap only) is widened by spec 196, slice P
(decisions `portail-perimetre`, `portail-desktop`, `portail-mode` in
`specs/196-ui-refresh/spec.md`). The user documentation promised it already
(« turn it on there and every way of opening the gate asks first ») while two
paths out of about twelve asked.

**What changes.** When `requireConfirmation` is on, every UI path where one tap or
click actuates the gate asks first, through one hook, `ui/src/hooks/useGuardedAction.ts`:

| Path                                                 | Before | After |
| ---------------------------------------------------- | ------ | ----- |
| Dashboard tile, phone, single action                 | asks   | asks  |
| Dashboard detail sheet, multi-action gate buttons    | no     | asks  |
| Dashboard tile ≥ 640 px (card click and buttons)     | no     | asks  |
| Timed tile (spec 174), arming                        | no     | asks  |
| Maison row: gate button and timed control (arming)   | no     | asks  |
| Equipment list quick control                         | no     | asks  |
| Equipment page: command buttons and timed control    | no     | asks  |
| Recipe tile card with `confirmFrom` (spec 171), desktop | no  | asks  |

**Form.** The form follows the pointer, not the width: a coarse pointer (touch)
gets the existing slide-to-confirm sheet; a fine pointer (mouse, trackpad) gets a
two-button dialog, « Annuler » and the action named on the primary button, Enter
confirms, Escape cancels.

**Wording.** The title says what the press will do: for an impulse, from the state
(open → « Fermer … ? », closed → « Ouvrir … ? », no state → « Actionner … ? »); for
a multi-action gate, from the button pressed (OPEN, CLOSE → Ouvrir, Fermer; any
other value → « Actionner », the value named in the subtitle). The multi-action
buttons show the same words instead of the raw enum values (STOP reads « Arrêter »).

**STOP never asks** (maintainer decision, phase 3 review). A stop is the one press
that must not wait: delaying it defeats its purpose. On a guarded gate, open,
close and operate (an impulse, or a value Sowel has no word for) ask; STOP is sent
at once, on every path (`gatePressNeedsConfirm` in `gate-confirm.ts`).

**Non-goals revised.** The first two non-goals above (desktop and non-dashboard
surfaces; multi-action gates) are lifted, and `gateNeedsConfirm` no longer
excludes multi-action gates. The rest stand, with these explicit exclusions:

- activating a mode whose impacts command the gate does not ask
  (`portail-mode`: activating a mode is already deliberate and touches several
  equipments);
- recipes' automations, the calendar, physical buttons and API tokens do not ask
  (no UI press);
- the recipe mode pill (the small button of a recipe tile or row) acts at once,
  as `docs/user/dashboard.md` documents;
- the shared-access guest page (spec 181) keeps its own deliberate gesture;
- zone commands target no gate, so nothing to guard there;
- still no server-side enforcement: the API accepts the order.

Cancelling a running timed window never asks: the confirmation precedes the
arming, not its undoing.
