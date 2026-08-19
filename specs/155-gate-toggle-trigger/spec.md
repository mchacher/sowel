# Spec 155 — Toggle-Based Gate Trigger Resolution (issue #627)

## Context

`resolveOrderValue()` (spec 150) resolves an empty (`null`/`undefined`/`""`) value on a boolean order binding to a fixed `true`, so a momentary "just trigger it" command (e.g. `GateControl`'s single button) reaches the wire as `"ON"` instead of a raw `null` that Z2M drops.

Real-hardware testing on a SONOFF MINI-ZBD driving a garage door (see `CONTEXT_ROMAIN.md`, not part of this repo) found that some relays with inching enabled never report their own auto-off — the integration's cached last-known value for that attribute stays stuck at whatever was last commanded. Resending the same fixed value is then silently absorbed (no re-trigger), because it doesn't represent a value _change_ from the integration's point of view. Only a genuine value change gets forwarded to the physical device.

Marc opened issue [#627](https://github.com/mchacher/sowel/issues/627) proposing to extend the `invertDirection` toggle (spec 154) to boolean gate triggers, so an install wired the opposite way can emit `OFF`. That is a static, one-shot fix: the second press would resend the same static value again and fail the same way.

## Goals

1. A `gate` (or any boolean-momentary-trigger) equipment stuck in this failure mode can be reliably triggered on every press, not just the first.
2. Existing installs relying on the current fixed-`true` behavior are unaffected — this is strictly opt-in per equipment.
3. No change to the trigger UI/UX (still a single button sending an empty value) — the fix lives entirely in value resolution.

## Safety / blast radius (read this before merging)

**No other Sowel installation is affected unless its own admin explicitly opts in, equipment by equipment.** Three independent guarantees, all required to hold:

1. **Migration default**: `gate_trigger_mode TEXT NOT NULL DEFAULT 'fixed'` — every equipment already in any existing database, on any existing installation, gets `'fixed'` automatically the moment this migration runs. No admin action required to keep today's behavior.
2. **Code default**: `resolveOrderValue()` only takes the new branch when `gateTriggerMode === "toggle"` exactly. Every other value (unset, `"fixed"`, anything else) falls through to the exact same code path that exists today — bit-for-bit identical resolution.
3. **UI default**: the new toggle in the equipment detail page ships unchecked, with a hint that explicitly scopes it to relays with the stuck-reported-state symptom. Nothing nudges an admin who isn't hitting this problem to turn it on.

This was a deliberate design constraint from the start (see Goal 2 and the Non-Goals below) — not an afterthought. On this repo's own dev instance, exactly one equipment (`PorteGarageGauche`) has ever had `gateTriggerMode: "toggle"` set, and it was set explicitly via the API for this spec's own real-hardware validation.

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
- [x] Real hardware: `PorteGarageGauche` (SONOFF MINI-ZBD) triggers reliably on repeated consecutive presses via the Sowel API with `gateTriggerMode: "toggle"` — validated on the dev VM 2026-08-19, 3/3 consecutive presses via `POST /equipments/:id/orders/command` moved the physical door (previously only the 1st worked, every subsequent press silently failed). Resolved value was `false` on every press (not alternating true/false as naively expected) — consistent with the device never truly reporting its rest state, so the cached "last known" value settles back to `true` between presses and the toggle logic correctly computes `false` again each time. Zero regression: 6/6 integrations, 48/48 devices online after deploy (the `netatmo_camera` "error" status is the known pre-existing OAuth token issue, unrelated).

## Edge Cases

- No prior device data at all for the binding's key (device just discovered, never reported) — falls back to `true`, identical to `"fixed"`.
- `gateTriggerMode: "toggle"` set on a non-boolean or non-empty-value order — no-op, existing enum/passthrough resolution is untouched.
- `gateTriggerMode: "toggle"` set on an equipment whose relay does NOT have this stuck-state quirk — will alternate ON/OFF/ON on every press instead of always ON. Intentional: opt-in only, admin must know their device needs this.
