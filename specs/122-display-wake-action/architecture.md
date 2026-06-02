# Architecture — Spec 122

## Data model

### Sowel `OrderCategory` (src/shared/types.ts)

```typescript
export type OrderCategory =
  | ...existing...
  | "set_language"
  | "set_display_brightness"
  | "display_wake"; // new
```

Mirrored in `ui/src/types.ts`. No other core type changes.

### Firmware NVS layout

| Key (NVS namespace `sowel-disp`) | Type   | Range   | Semantics                                            |
| -------------------------------- | ------ | ------- | ---------------------------------------------------- |
| `bright`                         | u8     | 0..100  | Current applied brightness (existing). 0 = panel off |
| `user_bright`                    | u8 NEW | 10..100 | Last user-chosen brightness, default 80              |

`user_bright` is created lazily on first user-driven set (slider, gesture, MQTT cmd ≥ 1). Until then, accessors return the firmware default (80).

### MQTT wire (spec 121 addendum)

| Sowel `OrderCategory` | Topic suffix | Payload |
| --------------------- | ------------ | ------- |
| `display_wake`        | `cmd/wake`   | (empty) |

State JSON gets a new optional field:

```json
{
  "id": "sowel-display-9a3b1c",
  ...,
  "brightness": 0,
  "wake": true
}
```

`wake: true` is a static capability advertisement — the firmware always sends it; it tells the plugin to expose the `display_wake` order on the device. Absence = the display does not support `cmd/wake` (older firmware, or vendor that does not implement the wake-to-preference behaviour).

## Event flow

### Recipe-driven sleep / wake (motion path)

```
Motion stops in the zone (no movement for absence_threshold)
  → recipe: goWaiting() → setTimeout(goSleep, absence_threshold)
    → timer expires → goSleep()
      → dispatchOrder(displayId, "brightness", 0)
        → EquipmentManager.executeOrder
          → plugin displays: dispatchOrder("brightness", 0)
            → MQTT publish <prefix>/<id>/cmd/brightness "0"
              → firmware: on_cmd_brightness(0)
                → brightness::set(0)
                  → cancel any pending auto-resleep timer (defensive — already cancelled)
                  → current_pct=0 persisted, user_pct unchanged

Motion resumes in the zone
  → recipe: goAwake() from sleeping
    → dispatchOrder(displayId, "wake", null)
      → plugin displays: dispatchOrder("wake", null) → cmd/wake topic
        → firmware: on_cmd_wake
          → brightness::set(user_pct) [via lv_async_call]
            → cancel any pending auto-resleep timer
            → current_pct=user_pct persisted
```

### Firmware-driven re-sleep (tap on dead panel, no motion)

```
User taps panel @ brightness=0 (recipe in `sleeping`, no motion)
  → firmware: screen_manager::on_press
    → brightness::wake_to_user_with_resleep_armed()
      → brightness::set(user_pct) [panel lights up]
      → auto_resleep::arm() [2 min timer started]

(2 minutes pass with no cmd/wake, no cmd/brightness, no local gesture)

  → auto_resleep::on_expire()
    → brightness::set(0) [panel off]
      → current_pct=0 persisted, user_pct unchanged
```

### Firmware-driven cancellation (tap then motion)

```
User taps panel @ brightness=0
  → wake + arm 2-min timer (as above)

Within 2 min:
Motion arrives in the zone
  → recipe: goAwake() from sleeping
    → dispatchOrder(displayId, "wake", null) → cmd/wake
      → firmware: on_cmd_wake
        → brightness::set(user_pct) → cancels auto-resleep timer
```

## File changes

### `sowel` (core)

- `src/shared/types.ts` — add `"display_wake"` to `OrderCategory`.
- `ui/src/types.ts` — mirror.
- `package.json` + `ui/package.json` — bump to `1.19.0`.
- `docs/release-notes.md` + `docs/release-notes.fr.md` — add `v1.19.0` entry.
- `plugins/registry.json` — bump `displays` plugin entry to `>=1.19.0`, bump `presence-display` recipe entry similarly.

### `sowel-plugin-displays` (v0.2.0)

- `src/parse-state.ts` — read `obj.wake` (boolean). If `true`, push an `OrderField` with `key: "wake"`, `category: "display_wake"`.
- `src/dispatch-order.ts` — add a case for `orderKey === "wake"` → publish to `cmd/wake` with empty payload.
- `src/parse-state.test.ts` — add fixture with `wake: true`.
- `src/dispatch-order.test.ts` — add test case `display_wake`.
- `manifest.json` — bump to `0.2.0`.

### `sowel-energy-display` (iter 035)

- `src/config.h` + `src/config.cpp` — add `user_brightness_pct()` / `set_user_brightness_pct(uint8_t)` accessors.
- `src/brightness.cpp` —
  - `init()`: if NVS `current_pct = 0`, restore from `user_pct` (or 80 fallback). Update `user_pct` if it was unset.
  - `set(pct)`: persist `user_pct` only when `pct >= MIN_PCT` (10..100); persist `current_pct` always. **Cancels any pending auto-resleep timer**.
  - `step(delta)`: existing logic + **cancels any pending auto-resleep timer**.
  - New `wake_to_user_with_resleep_armed()` entry point: sets to `user_pct` AND arms the auto-resleep timer. Used only by `screen_manager::on_press`.
- `src/auto_resleep.{h,cpp}` — new module owning the timer:
  - `arm()`: schedules `lv_timer` for `AUTO_RESLEEP_MS = 2 * 60 * 1000` (single-shot). Replaces any previous pending timer.
  - `cancel()`: deletes the pending timer if any. Safe to call when none armed.
  - `on_expire()`: calls `brightness::set(0)` and clears the handle.
  - State: single `static lv_timer_t* timer = nullptr`. Not armed at boot.
- `src/screen_manager.cpp` — `on_press` (panel was off branch) calls `brightness::wake_to_user_with_resleep_armed()` instead of `brightness::set(WAKE_FROM_OFF_PCT)`.
- `src/mqtt_supervision.cpp` — add `on_cmd_wake` handler (marshalled via `lv_async_call`) → calls `brightness::set(user_pct)`. Update `on_message` topic dispatch. Publish `"wake": true` in `mqtt_supervision_state::build`.
- `src/mqtt_supervision_state.{h,cpp}` — add static `wake` flag to the State struct + JSON serialiser.
- `test/test_brightness/` — new native test covering the NVS split.
- `test/test_auto_resleep/` — new native test covering arm/cancel/expire semantics.
- `platformio.ini` — no change.

### `sowel-recipe-presence-display` (v0.2.0)

- `src/index.ts` —
  - Remove `wake_brightness` from slots, defaults, and i18n.
  - Remove `WAKE_MIN`/`WAKE_MAX`/`DEFAULT_WAKE` constants.
  - `validate()`: require each display to expose an order with category `display_wake` (in addition to the existing `set_display_brightness` check).
  - Replace `dispatch(wakeBrightness, "wake")` with `dispatchWake(displayId)` that resolves the `display_wake` alias on the equipment.
  - **Keep the state machine minimal**: `awake / waiting / sleeping`. No `manual_wake`, no `equipment.data.changed` subscription — the firmware self-extinguishes on tap-wake without recipe involvement.
  - `stop()`: drop the "wake to wake_brightness" safety branch (no longer applicable).
- `src/index.test.ts` —
  - Update existing tests (remove `wake_brightness` slot, switch dispatch assertions to `display_wake`).
  - Add validation refusal test when `display_wake` order is missing.
- `package.json` — bump to `0.2.0`.

## Soft-isolation impact (spec 111)

None. The new order category is dispatched through the existing `EquipmentManager.executeOrder` path; the plugin remains scoped to its own settings (`integration.displays.*`) and only emits the allowed event types. No allowlist change in `src/plugins/scoped-deps.ts`.
