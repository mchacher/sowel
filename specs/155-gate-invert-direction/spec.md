# Spec 155 — Invert Direction for Boolean Gate Triggers (issue #627)

## Context

`resolveOrderValue()` (spec 150) resolves an empty (`null`/`undefined`/`""`) value on a boolean order binding to a fixed `true`, so a momentary "just trigger it" command (e.g. `GateControl`'s single button) reaches the wire as `"ON"` instead of a raw `null` that Z2M drops.

Some gate installs are wired the opposite way — the relay is wired to trigger on the `OFF` edge instead of `ON` (issue [#627](https://github.com/mchacher/sowel/issues/627), reported against a SONOFF MINI-ZBD driving a garage door). There was previously no way to make a `gate`'s boolean trigger emit `OFF`.

An earlier iteration of this spec explored a dynamic "read the device's last known state and send the inverse" resolution, validated on real hardware (3/3 consecutive triggers worked). Marc pointed out a simpler explanation for that same result: the relay auto-reverts to `ON` between presses, so a **static** `OFF` is an edge every single time — no need to read device state back at all. Confirmed by our own data: the dynamic version resolved to the exact same value (`false`) on every one of the 3 presses, never alternating. This spec supersedes that iteration with the simpler, static approach.

## Goals

1. A `gate` equipment wired to trigger on `OFF` instead of `ON` can be configured to do so.
2. Existing installs are unaffected — this is the existing `invertDirection` per-equipment toggle (spec 154), extended to a new case, not a new default.
3. No change to the trigger UI/UX (still a single button sending an empty value) — the fix lives entirely in value resolution.

## Non-Goals

- Dynamic/state-dependent resolution (the earlier `gateTriggerMode: "toggle"` iteration) — dropped in favor of this simpler approach; would only be worth revisiting if a real install is found where the relay's rest state is NOT stable/predictable.
- Auto-detecting which direction an install needs — admin sets `invertDirection` explicitly, same as for shutters.

## Functional Requirements

### FR1 — Reuse `invertDirection` for boolean gate triggers

No new field. `Equipment.invertDirection` (spec 154) is extended: when `true` and the order's first binding is `boolean` with an empty value, `resolveOrderValue()` resolves to `false` instead of `true`. When `invertDirection` is unset/`false`, behavior is unchanged (spec 150).

### FR2 — UI toggle on gate equipments

`InvertDirectionPanel` (already shipped for shutter-family + pool_cover) is also mounted for `gate` equipments. Copy is type-aware: shutter/pool_cover keeps "Invert open/close direction" wording, `gate` gets "Invert trigger command" wording that doesn't reference open/close/position.

## Safety / blast radius (read this before merging)

**No other Sowel installation is affected unless its own admin explicitly opts in, equipment by equipment.** This reuses the existing `invert_direction` column and `invertDirection` field from spec 154 — no new migration, no new column. The guarantees are the same ones already shipped and running in production for shutters:

1. **Column default**: `invert_direction INTEGER NOT NULL DEFAULT 0` (spec 154's migration `024_equipment_invert_direction.sql`) — already the default for every equipment on every installation.
2. **Code default**: `resolveOrderValue()`'s boolean-empty branch only flips to `false` when `invertDirection` is truthy; every equipment that has never touched this flag keeps resolving to `true`, bit-for-bit identical to before this change.
3. **UI default**: the toggle ships unchecked; a `gate` admin who isn't hitting a wired-backwards install has no reason to enable it.

On this repo's own dev instance, exactly one equipment (`PorteGarageGauche`, the one from the original report) has this enabled.

## Acceptance Criteria

- [x] `invertDirection: true` on a `gate`: an empty trigger resolves to `false` (`"OFF"` on the wire).
- [x] `invertDirection: false`/unset on a `gate` (default): an empty trigger resolves to `true` (`"ON"`) — unchanged from before this spec.
- [x] An explicit non-empty value (e.g. `"ON"`) passes through untouched regardless of `invertDirection` — only the empty-trigger default is affected.
- [x] Consecutive triggers on an inverted gate all resolve to the same `false` value (no dependency on device-reported state, unlike the dropped dynamic iteration).
- [x] The delivery-retry guard (spec 141) applies here too: a retry with the RETRY_CHANNEL source is never re-inverted.
- [ ] Real hardware: `PorteGarageGauche` (SONOFF MINI-ZBD) triggers reliably on repeated consecutive presses via the Sowel API with `invertDirection: true` — to (re-)validate on the dev VM, since the mechanism changed from the dynamic iteration even though the practical outcome should be identical.

## Edge Cases

- `invertDirection: true` set on a non-boolean or non-empty-value order — no-op, existing enum/passthrough resolution and the shutter-family semantic inversion (`invertShutterCommand`) are both untouched; a stray flag on an unrelated equipment type has no effect (same guarantee as spec 154 already had).
- `invertDirection: true` set on a `gate` whose relay does NOT need this (wired the standard way) — will send `OFF` instead of `ON`, i.e. will stop working. Same expectation as inverting a shutter that isn't wired backwards: admin-controlled, admin must know their device needs it.
