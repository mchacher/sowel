# Plan — Spec 122

## Implementation order

The four repos depend on each other:

1. **Sowel core first** — without `"display_wake"` in `OrderCategory`, the plugin and recipe TS won't typecheck.
2. **Plugin displays second** — needs the new core type.
3. **Firmware third** — independent of the TS chain, but the plugin needs the `wake: true` state field to be useful; ship them together.
4. **Recipe last** — needs both the new core type and the plugin to advertise the order on devices.

Each repo: feature branch → implement → tests → PR → CI → merge → tag/release.

## Sowel core (PR 1)

- Branch: `feat/122-display-wake-action`
- Files: `src/shared/types.ts`, `ui/src/types.ts`, `package.json`, `ui/package.json`, `docs/release-notes.md`, `docs/release-notes.fr.md`, `plugins/registry.json` (defer registry to PR 2/4 so each plugin bump is its own commit).
- Validate: `npm run validate` (full).
- Release: `scripts/release.sh 1.19.0` after merge.

## Plugin sowel-plugin-displays (PR 2)

- Branch: `feat/display-wake-order`
- Implement `parseState.wake` declaration + `dispatchOrder("wake", ...)`.
- Tests: extend `parse-state.test.ts` and `dispatch-order.test.ts`.
- Validate: `npm run validate` in the plugin repo.
- Release: tag `v0.2.0`, GitHub Actions builds tarball.
- Then: PR back to Sowel `plugins/registry.json` to bump SHA256 (no Sowel release).

## Firmware sowel-energy-display iter 035 (PR 3)

- Branch: `feat/035-display-wake-user-pref`
- Spec folder: `specs/035-display-wake-user-pref/spec.md` per the `sowel-display-iterate` skill.
- Implement: NVS split, `cmd/wake` handler, wake-on-touch update, state JSON `wake: true`.
- Validate: `pio run -e esp32-s3-touch-amoled-1_75` clean, `pio test -e native` green.
- HW test: flash + verify on the panel (slider sets brightness, panel goes to 0 via Sowel slider, click wakes to slider value).
- Release: tag `v1.X.0` (current version + minor bump).

## Recipe sowel-recipe-presence-display (PR 4)

- Branch: `feat/manual-wake-state`
- Implement: slot removal, validation update, `display_wake` dispatch, `manual_wake` state machine.
- Tests: update existing + add manual-wake scenarios.
- Release: tag `v0.2.0`.
- Then: PR back to Sowel `plugins/registry.json` to bump version + SHA256 + `sowelVersion: ">=1.19.0"` (no Sowel release).

## Test Plan

### Modules to test

| Repo                            | Module                                | New / changed scenarios                                                  |
| ------------------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| sowel (core)                    | Nothing functional                    | Existing test suite must still pass (typecheck + lint validate the type) |
| sowel-plugin-displays           | `parse-state.ts`, `dispatch-order.ts` | `wake: true` parsing; `wake` dispatch                                    |
| sowel-energy-display (firmware) | `brightness.cpp`, `config.cpp`        | NVS split, boot recovery, set(0) does not touch user_pct                 |
| sowel-recipe-presence-display   | `index.ts`                            | Slot removal, validation, manual_wake transitions                        |

### Scenarios

#### Plugin parse-state.ts

| Scenario             | Expected                                                             |
| -------------------- | -------------------------------------------------------------------- |
| `state.wake = true`  | Output `orders` contains `{ key: "wake", category: "display_wake" }` |
| `state.wake` absent  | Output `orders` does NOT include a wake entry                        |
| `state.wake = false` | Output `orders` does NOT include a wake entry                        |

#### Plugin dispatch-order.ts

| Scenario                               | Expected                                           |
| -------------------------------------- | -------------------------------------------------- |
| `dispatchOrder(prefix, id, "wake", ?)` | `{ topic: "<prefix>/<id>/cmd/wake", payload: "" }` |

#### Firmware brightness.cpp (native test)

| Scenario                                               | Expected                                       |
| ------------------------------------------------------ | ---------------------------------------------- |
| Cold boot, NVS empty                                   | `current_pct = 80`, `user_pct = 80`            |
| Boot with `current_pct = 0`, `user_pct = 30`           | After `init()`: `current_pct = 30`             |
| Boot with `current_pct = 0`, `user_pct` absent         | After `init()`: `current_pct = 80` (fallback)  |
| `set(0)` after `set(30)`                               | `current_pct = 0`, `user_pct = 30` (preserved) |
| `set(50)` after `set(30)`                              | `current_pct = 50`, `user_pct = 50` (updated)  |
| `set(5)` (clamped to 10)                               | `current_pct = 10`, `user_pct = 10`            |
| `wake_to_user_with_resleep_armed()` when `user_pct=30` | `current_pct = 30`, timer pending              |

#### Firmware auto_resleep (native test)

| Scenario                                             | Expected                                          |
| ---------------------------------------------------- | ------------------------------------------------- |
| `arm()` then wait 2 min                              | `brightness::set(0)` invoked once                 |
| `arm()` then `cancel()` before expiry                | No `brightness::set(0)` invocation                |
| `arm()` then `arm()` again                           | Only one timer pending, expires once              |
| `cancel()` when not armed                            | No-op, no crash                                   |
| `arm()` then `brightness::set(50)` (MQTT cmd)        | Timer cancelled (suppression on explicit set)     |
| `arm()` then `brightness::step(+10)` (gesture)       | Timer cancelled (suppression on explicit gesture) |
| `arm()` then `brightness::set(0)` (recipe sleep cmd) | Timer cancelled; panel re-extinguishes (no-op)    |

#### Recipe state machine

| Scenario                                           | Expected                                                      |
| -------------------------------------------------- | ------------------------------------------------------------- |
| Validate without `wake_brightness` slot            | OK (slot does not exist anymore)                              |
| Validate with display lacking `display_wake` order | Throw, descriptive error                                      |
| Motion=true while sleeping                         | Dispatch `display_wake` (no value), state → awake             |
| Motion=true while awake                            | No dispatch (already awake)                                   |
| Motion=false while awake                           | State → waiting, timer starts                                 |
| Timer expires                                      | Dispatch `set_display_brightness 0`, state → sleeping         |
| Motion=true during waiting                         | Timer cancelled, state → awake, NO dispatch (panel still lit) |
| Recipe stop() while sleeping                       | No dispatch (firmware owns the wake; recipe stays out of it)  |

## Robustness test plan

Beyond the per-module unit tests above, the feature must survive a set of stress / failure-injection scenarios. These run as a mix of native tests (where possible) and HW-in-the-loop manual scenarios (signed off in the firmware iter spec or this spec's checklist).

### R1 — NVS persistence under power loss

Goal: a power cut during a brightness write must not leave the firmware with an inconsistent state (e.g. `current_pct=50` persisted but `user_pct=0` corrupted).

| Scenario                                                                                   | Expected                                                                                                         | How                                                            |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Power cut during `set(30)` between `current` and `user` writes                             | Either both values are old, or both are new — never a mismatch                                                   | Native test with mocked NVS writer faulting between key writes |
| Power cut during slider drag (multiple set() in flight, debounced NVS timer not yet fired) | After reboot, NVS holds either the pre-drag value or some intermediate the user actually crossed — never garbage | HW: drag slider, yank power, reboot                            |
| NVS holds out-of-range value (`user_pct=255`, flash garbage)                               | `init()` clamps to MAX_PCT=100 and persists the clamped value                                                    | Native test                                                    |

### R2 — Command flood (slider drag)

Goal: a 10-second slider drag at 60Hz (600+ cmd/brightness publishes) does not crash, leak FreeRTOS handles, or desync the state.

| Scenario                                                    | Expected                                                                                                              | How                                      |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 600 cmd/brightness publishes in 10 s via mosquitto_pub loop | Firmware applies the LATEST value (coalescing via `lv_async_call`), no crash, single NVS write at debounce window end | HW: scripted MQTT flood + serial monitor |
| Concurrent cmd/wake during a flood                          | Wake either races a brightness value (idempotent — both restore user_pct effectively) or is preempted; never crashes  | HW: scripted flood + wake interlace      |

### R3 — Network resilience

Goal: MQTT broker disconnects, reconnects, and lossy networks do not break the sleep/wake cycle.

| Scenario                                                            | Expected                                                                                                                         | How                                           |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Broker dies while recipe sends cmd/brightness 0                     | Order is fire-and-forget; firmware does not receive, panel stays lit (LWT will fire offline on plugin side)                      | Manual: kill mosquitto, observe               |
| Broker reconnect after a long outage                                | Display republishes `online` + state with `wake: true`; plugin re-derives the `display_wake` order                               | Manual: restart mosquitto, observe state JSON |
| Display loses WiFi, reconnects                                      | After LWT fires, EquipmentStatus turns degraded. Once back online, the recipe's next motion-driven dispatch reaches the display. | Manual: airplane mode toggle                  |
| Recipe dispatch while display equipment is `unavailable` (spec 116) | `executeOrder` does NOT throw; the order is queued at plugin level, dropped if not delivered. Recipe logs `warn`.                | Manual                                        |

### R4 — Recipe restart / state recovery

Goal: Sowel restart in the middle of a sleep cycle leaves the system in a consistent state on next boot.

| Scenario                                                  | Expected                                                                                                                                                                                                                            | How                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Sowel restart while recipe is in `sleeping`               | Recipe re-initialises: reads current zone motion (false). Initial sync → `waiting` → expires → `sleeping`. Dispatches `set_display_brightness 0` (already 0, no-op visible).                                                        | Manual: stop sowel, restart, check logs         |
| Sowel restart while user has just tapped a sleeping panel | Recipe doesn't know or care about the tap. Firmware auto-resleep timer continues running (firmware-internal). If no motion arrives, panel auto-extinguishes. If motion arrives, recipe dispatches `display_wake` and timer cancels. | Manual: tap display, restart sowel within 2 min |
| Sowel restart while recipe is in `awake`                  | Recipe re-initialises: motion=true → state=awake. No dispatch — panel already lit (unless firmware booted in the meantime, but it kept current_pct=user_pct from NVS, so panel is also lit).                                        | Manual                                          |
| Recipe deactivated (user disables it) while in `sleeping` | `stop()` does NOT dispatch. Display stays at brightness=0. User can recover via tap (firmware wake-on-touch restores user_pct, auto-resleeps after 2 min).                                                                          | Recipe unit test + manual                       |
| Recipe deactivated while in `awake`                       | `stop()` cancels recipe timer, does NOT dispatch. Display stays lit. Firmware does not auto-resleep (no tap-wake event). Display stays lit indefinitely until external action.                                                      | Recipe unit test                                |

### R5 — Multi-display robustness

Goal: a recipe instance bound to N displays handles partial failures gracefully.

| Scenario                                    | Expected                                                                                                                                                                                                                         | How                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 2 displays, 1 offline                       | Recipe dispatches to both; the offline one logs `warn` but the online one is served. State transitions still happen on the recipe side.                                                                                          | Manual (or recipe unit test with mocked executeOrder rejecting for one displayId) |
| 2 displays, only one publishes `wake: true` | `validate()` refuses to start the recipe instance (all selected displays must declare the order).                                                                                                                                | Recipe unit test                                                                  |
| 2 displays, user taps display A only        | Display A wakes locally, A's auto-resleep timer arms. Display B stays off. If no motion arrives within 2 min, A auto-resleeps independently. Each display owns its own firmware-side timer; the recipe state remains `sleeping`. | HW + serial inspection                                                            |

### R6 — State machine soak

Goal: 24h continuous cycling of motion / no-motion / timer expiry does not leak memory, timers, or event subscriptions.

| Scenario                                                          | Expected                                                                            | How                                                                             |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --- | ------------------- |
| Recipe instance running 24h with simulated motion every 5 min     | Memory flat, no orphan timers, no event-listener leak                               | Manual: leave running overnight, inspect `process.memoryUsage()` deltas via API |
| Recipe alternating sleep / wake / sleep every minute              | No state stuck, no double-dispatch, exactly one recipe timer at all times           | Recipe instrumentation test (assert `timer===null                               |     | state==='waiting'`) |
| Firmware alternating tap-wake / auto-resleep repeatedly (no MQTT) | No timer leak on the firmware side either; serial logs show clean arm/expire cycles | HW: scripted tap simulation over an hour                                        |

### R7 — Firmware boot recovery matrix

Goal: every possible NVS state at boot resolves to a usable panel.

| NVS state              | Expected after `init()`                                   |
| ---------------------- | --------------------------------------------------------- |
| Empty (first boot)     | `current = 80`, `user = 80`                               |
| `current=50, user=50`  | `current = 50`, `user = 50` (no change)                   |
| `current=0, user=30`   | `current = 30`, `user = 30` (recovery to user)            |
| `current=0, user=0`    | `current = 80`, `user = 80` (double fallback)             |
| `current=0, user=5`    | `current = 10`, `user = 10` (recovery + clamp to MIN_PCT) |
| `current=255, user=80` | `current = 100`, `user = 80` (clamp current to MAX_PCT)   |
| `current=80, user=255` | `current = 80`, `user = 100` (clamp user)                 |

Covered by R1 (NVS test) + R7 (init test).

### Robustness sign-off checklist

Final acceptance gate before merging the Sowel core PR:

- [ ] R1 — NVS power-loss native test green; HW power-cut smoke test signed off.
- [ ] R2 — Slider flood test on HW: 600+ cmds, no crash, NVS quiet.
- [ ] R3 — Broker kill + reconnect cycle: state recovers, recipe resumes.
- [ ] R4 — Sowel restart in each of the 3 recipe states: no spurious dispatch.
- [ ] R5 — Multi-display: offline display does not block the others.
- [ ] R6 — 24h soak: memory flat, no leaks.
- [ ] R7 — Boot recovery matrix fully covered by native tests.

## Validation gates (per repo)

Each PR must pass:

- **Sowel**: `npm run validate` (typecheck + lint + format:check + test + validate:ui).
- **Plugin displays**: `npm run validate` (typecheck + tests).
- **Firmware**: `pio run` clean, `pio test -e native` all green, HW smoke test signed off in spec.
- **Recipe**: `npm run validate` (typecheck + tests).
- **Spec 122 robustness sign-off**: every item in the "Robustness sign-off checklist" above is `[x]`.
