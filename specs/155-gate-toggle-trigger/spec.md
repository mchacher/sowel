# Spec 155 — Toggle-Based Gate Trigger Resolution (issue #627)

## Context

`resolveOrderValue()` (spec 150) resolves an empty (`null`/`undefined`/`""`) value on a boolean order binding to a fixed `true`, so a momentary "just trigger it" command (e.g. `GateControl`'s single button) reaches the wire as `"ON"` instead of a raw `null` that Z2M drops.

Real-hardware testing on a SONOFF MINI-ZBD driving a garage door (see `CONTEXT_ROMAIN.md`, not part of this repo) found that some relays with inching enabled never report their own auto-off — the integration's cached last-known value for that attribute stays stuck at whatever was last commanded. Resending the same fixed value is then silently absorbed (no re-trigger), because it doesn't represent a value _change_ from the integration's point of view. Only a genuine value change gets forwarded to the physical device.

Marc opened issue [#627](https://github.com/mchacher/sowel/issues/627) proposing to extend the `invertDirection` toggle (spec 154) to boolean gate triggers, so an install wired the opposite way can emit `OFF`. That is a static, one-shot fix: the second press would resend the same static value again and fail the same way.

## Goals

1. A `gate` (or any boolean-momentary-trigger) equipment stuck in this failure mode can be reliably triggered on every press, not just the first.
2. Existing installs relying on the current fixed-`true` behavior are unaffected — this is strictly opt-in per equipment.
3. No change to the trigger UI/UX (still a single button sending an empty value) — the fix lives entirely in value resolution.

## Non-Goals

- Static `invertDirection`-style fixed-OFF option for gates (issue #627's original proposal) — superseded by this approach for the reported use case; could still be added separately if a real install needs a genuinely fixed non-`ON` value with no toggle behavior.
- Auto-detecting which equipments need this (no heuristic based on repeated-failure patterns) — admin opts in explicitly per equipment.

## Functional Requirements

### FR1 — `gateTriggerMode` equipment field

New optional field on `Equipment`, `"fixed" | "toggle"`, default `"fixed"`. Exposed via `PUT /api/v1/equipments/:id`.

### FR2 — Toggle resolution

When `gateTriggerMode === "toggle"` and the order's first binding is `boolean` with an empty value: resolve to the logical inverse of `DeviceManager.getDeviceDataValueById(binding.device_id, binding.key)`. Falls back to `true` (matching the "fixed" default) when no prior value is known — same behavior as today on a first-ever trigger.

### FR3 — UI toggle

Admin-only panel on the equipment detail page, gate types only, mirroring `InvertDirectionPanel` (spec 154).

## Acceptance Criteria

- [x] `gateTriggerMode` defaults to `"fixed"` on every equipment; existing behavior (`resolves null to true`) is unchanged when unset.
- [x] With `gateTriggerMode: "toggle"` and no prior known value, an empty trigger resolves to `true` (same as `"fixed"`).
- [x] With `gateTriggerMode: "toggle"` and last known value `true`, an empty trigger resolves to `false`.
- [x] With `gateTriggerMode: "toggle"` and last known value `false`, an empty trigger resolves to `true`.
- [x] `gateTriggerMode` round-trips through `update()`.
- [x] API rejects any value other than `"fixed"`/`"toggle"`.
- [ ] Real hardware: `PorteGarageGauche` (SONOFF MINI-ZBD) triggers reliably on repeated consecutive presses via the Sowel UI/API with `gateTriggerMode: "toggle"` — to validate on the dev VM before considering this done.

## Edge Cases

- No prior device data at all for the binding's key (device just discovered, never reported) — falls back to `true`, identical to `"fixed"`.
- `gateTriggerMode: "toggle"` set on a non-boolean or non-empty-value order — no-op, existing enum/passthrough resolution is untouched.
- `gateTriggerMode: "toggle"` set on an equipment whose relay does NOT have this stuck-state quirk — will alternate ON/OFF/ON on every press instead of always ON. Intentional: opt-in only, admin must know their device needs this.
