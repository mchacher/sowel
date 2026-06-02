# Spec 122 — Display wake action + user-preferred brightness

## Context

Spec 120 introduced the `display` equipment type with a single brightness order (`set_display_brightness`). The presence-driven sleep recipe (`sowel-recipe-presence-display`) currently dispatches `set_display_brightness 0` to sleep and `set_display_brightness <wake_brightness>` to wake — where `wake_brightness` is a recipe slot defaulting to 80%.

Two issues surfaced in real use:

1. **Wake brightness ignores the user's preference.** When the user has dialled the display to 30% on the slider, the recipe still wakes it at the slot's value (default 80%). The firmware also hardcodes the wake-on-touch fallback at 80%. Both contradict the principle "the user owns the display brightness, the recipe owns the on/off cycle".

2. **Manual user override is not respected.** If the user wakes a sleeping display (by clicking it, or by moving the slider via the equipment panel), the recipe stays in `sleeping` state because it only watches motion. The display stays lit indefinitely, with no auto re-sleep after the configured absence.

This spec adds the missing capability to the `display` equipment type — a dedicated wake action that restores the firmware's last user-chosen brightness — and pushes the "re-sleep after a user-initiated wake" responsibility down to the firmware itself via a hardcoded 2-minute auto-resleep timer. The recipe stays a pure motion-driven state machine; no UI-event observation, no `manual_wake` state. The firmware self-extinguishes after a tap-wake if no MQTT confirmation arrives — which makes the system robust even when Sowel is down.

## Goals

1. Add `"display_wake"` to Sowel's `OrderCategory` union (core type), so a `display` equipment can advertise a no-value wake order alongside `set_display_brightness` and `set_language`.

2. Document the canonical MQTT wire mapping for `display_wake` in spec 121: order → `<prefix>/<id>/cmd/wake` topic, empty payload, fire-and-forget.

3. In `sowel-plugin-displays`:
   - Parse `wake` from the firmware's state JSON (when present) and expose a matching `display_wake` order on the device. Polymorphic: a display that does not publish `"wake": true` in its state simply does not get the order, no failure.
   - Route the `display_wake` order key to `cmd/wake` in `dispatch-order.ts`.

4. In `sowel-energy-display` firmware:
   - Split NVS into two values: `current_pct` (last applied brightness, can be 0) and `user_pct` (last user-chosen brightness ≥ MIN_PCT=10, default 80). The two are written independently: a remote `cmd/brightness 0` updates `current_pct` only; any user-driven set (slider, gesture, MQTT cmd ≥ 1) updates both.
   - Add `cmd/wake` MQTT handler → restores `brightness::set(user_pct)` and cancels any pending auto-resleep timer.
   - Wake-on-touch in `screen_manager` switches from the hardcoded 80% to `user_pct` AND arms a 2-minute auto-resleep timer.
   - **Auto-resleep mechanism (new)**: when the panel is woken locally by a tap on an off panel, the firmware starts a hardcoded 2-minute timer. If the timer expires without any `cmd/wake` / `cmd/brightness` / local gesture arriving, the panel auto-extinguishes (`brightness::set(0)`). Any incoming `cmd/wake`, `cmd/brightness`, or local gesture (`brightness::step`) cancels the timer. **Default at boot: no timer pending** (a freshly-booted display does not auto-sleep just because nobody talks to it).
   - Boot recovery (when NVS `current_pct=0`) restores to `user_pct` if available, falling back to 80.
   - Publish `"wake": true` in state JSON so the plugin can expose the order.

5. In `sowel-recipe-presence-display`:
   - Remove the `wake_brightness` slot entirely.
   - On wake (motion resumed): dispatch `display_wake` (no value) instead of `set_display_brightness <N>`.
   - **No `manual_wake` state, no `equipment.data.changed` subscription.** The recipe stays a pure motion-driven state machine (`awake / waiting / sleeping`). The "user tap on a sleeping panel" case is handled entirely by the firmware's auto-resleep mechanism: the panel lights up locally and re-extinguishes on its own after 2 min if motion never arrives. If motion does arrive within that window, the recipe sends `display_wake` and the firmware cancels its auto-resleep timer.

## Non-Goals

- New display data field. The user preference stays inside the firmware (NVS); it is not surfaced as a Sowel data row. (Considered briefly, rejected as "more telemetry pollution than benefit".)
- Multi-tenancy of `user_pct`. The firmware tracks a single user preference; there is no per-user, per-zone, or per-recipe variant.
- Backwards-compatible fallback in the recipe for older firmware that does not declare `display_wake`. The recipe's `validate()` will refuse to start if any selected display lacks the order — same way it already refuses if `set_display_brightness` is missing.

## Acceptance criteria

### Sowel core

- [ ] `OrderCategory` includes `"display_wake"` in both `src/shared/types.ts` and `ui/src/types.ts`.
- [ ] `npm run validate` (full) passes — no other code change needed in core; the routing by OrderCategory is generic.

### Plugin `sowel-plugin-displays` v0.2.0+

- [ ] `parse-state.ts` declares a `display_wake` order when `state.wake === true`.
- [ ] `dispatch-order.ts` routes orderKey `wake` to `<prefix>/<id>/cmd/wake` with empty payload.
- [ ] New tests: `parse-state.test.ts` adds a fixture with `wake: true`; `dispatch-order.test.ts` adds a `wake_display` dispatch case.
- [ ] Released, registry entry bumped + SHA256 refreshed (no Sowel release for the registry alone).

### Firmware `sowel-energy-display` iter 035

- [ ] NVS split: `config::brightness_pct()` (current) + new `config::user_brightness_pct()` (preference).
- [ ] `brightness::set(0)` writes only `current_pct`; `brightness::set(N>=10)` writes both.
- [ ] `brightness::set(1..9)` clamps to 10 and writes both (existing behaviour preserved).
- [ ] New `brightness::wake_to_user_with_resleep_armed()` entry point used by `screen_manager::on_press`: sets to `user_pct` AND arms the 2-min auto-resleep timer.
- [ ] `brightness::set` and `brightness::step` cancel any pending auto-resleep timer (so MQTT cmds and gestures naturally suppress the firmware-initiated resleep).
- [ ] New `mqtt_supervision::on_cmd_wake` handler → calls `brightness::set(user_pct)` (which cancels the timer naturally), marshalled via `lv_async_call`.
- [ ] `screen_manager::on_press` wake-on-touch uses `user_pct` (via `wake_to_user_with_resleep_armed`) instead of hardcoded 80%.
- [ ] **Auto-resleep timer (2 min hardcoded)** fires `brightness::set(0)` on expiry. Default at boot: not armed.
- [ ] Boot recovery: if `current_pct=0` at init, restore `user_pct` (or 80 fallback).
- [ ] State JSON publishes `"wake": true`.
- [ ] `pio test -e native` covers the NVS split logic AND the auto-resleep timer behaviour.

### Recipe `sowel-recipe-presence-display` v0.2.0+

- [ ] `wake_brightness` slot removed from the slot list and from i18n.
- [ ] `validate()` checks every selected display exposes a `display_wake` order binding; refuses otherwise.
- [ ] `createInstance` dispatches `display_wake` (value ignored) on motion-resumed.
- [ ] State machine stays minimal (`awake / waiting / sleeping`) — no `manual_wake`, no `equipment.data.changed` subscription.
- [ ] Unit tests cover the validation refusal when `display_wake` is missing, the `display_wake` dispatch on motion-resumed, and the existing sleep cycle.
- [ ] Released, registry entry bumped + SHA256 refreshed (registry update PR rides on the Sowel core release, since the recipe requires `sowelVersion: ">=1.19.0"`).

### Robustness

- [ ] All R1..R7 robustness scenarios in `plan.md` are executed (native tests automated, HW scenarios manually signed off in this spec). The "Robustness sign-off checklist" in `plan.md` must be fully ticked before the Sowel core PR is merged.

## Edge cases

- **Display has not yet sent its first state payload after upgrade** — the plugin has not yet declared the `display_wake` order; the recipe instance refuses to start. User retries once the display has reconnected. Same semantic as today for `set_display_brightness`.

- **Display has `user_pct=0` in NVS somehow** (corrupt config, manual reset) — firmware's boot recovery and `cmd/wake` handler fall back to 80. Hard floor at MIN_PCT=10 means the panel cannot stay dark on wake.

- **User taps the sleeping panel, then no motion for 30 min** — firmware wakes locally, arms the 2-min timer, no `cmd/wake` arrives (recipe still in `sleeping`), timer fires, panel re-extinguishes. The display is autonomous; Sowel/recipe presence is not required.

- **User taps the sleeping panel, motion arrives 30 seconds later** — firmware wakes locally + arms timer. Motion → recipe transitions `sleeping → awake`, dispatches `display_wake`. Firmware cancels its auto-resleep timer. Panel stays on as long as motion continues.

- **User taps the sleeping panel, then nudges the slider (in Sowel UI) within the 2 min** — the slider sends `cmd/brightness <N>`. Firmware applies it AND cancels the auto-resleep timer (any explicit `set` cancels). Panel stays on until the recipe's normal absence cycle kicks in.

- **Recipe in `awake` (motion present), user nudges brightness to 0 via slider** — the recipe does NOT dispatch wake. The user explicitly chose to turn it off; the recipe respects that until motion changes again. State stays `awake`, but the next motion=false → `waiting` → timer fires `goSleep` which dispatches `set_display_brightness 0` (already 0, no-op visible).

- **Display freshly booted, no recipe interaction yet** — `user_pct` defaults to 80, panel is at 80. No auto-resleep timer pending (the auto-resleep mechanism only engages after a tap-wake on a previously-off panel). Recipe init eventually arrives, sees motion=false → waits absence_threshold → dispatches sleep. Normal cycle.
