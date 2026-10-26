# Spec 188: Order delivery receipt

**Status**: Implemented (core) — the lora2mqtt plugin side ships in its own PR
**Depends on**: spec 141 (order confirmation tracker), spec 181 (shared access), spec 146 (gate)
**System spec**: `domotique-lora/specs/command-receipt.md` (rules C1–C20), which this spec consumes

## Problem

`executeOrder` resolving means the order reached the integration. For a radio device that
is all Sowel ever learns. Spec 141 closes the gap when the order has a state to watch, but a
gate impulse has none: the `command` order is exempt from the tracker, so a lost gate
command is invisible end to end. The guest pressing the gate in the shared-access PWA reads
« Commande envoyée » whether the gate got the command or not, and the journal records
`opened` either way.

The LoRa chain can now say what happened to each command — applied, refused by the node,
not received, or no confirmation — and publishes it on `lora2mqtt/<node>/receipt`. Nothing
in Sowel can carry that today: plugins may only emit integration and alarm events.

## Goals

1. A generic way for any integration to report, per device order, what the device made of it.
2. Show it where the person who gave the order looks: the dashboard tile, an alarm with a
   push notification, and the guest's shared-access PWA and journal.
3. Never resend an order because of a receipt (decided 2026-10-26: an impulse resent after a
   lost receipt reverses the gate).

## Non-goals

- No automatic resend, and no change to spec 141's reconnect re-dispatch.
- Receipts do not confirm a state: a confirmable order still needs its mirror binding to
  move (spec 141). The two are independent.
- No persistence of pending receipts across a restart.

## Functional design

### R1 — The receipt event

A new engine event, emittable by plugins:

```ts
{
  type: "device.order.receipt";
  integrationId: string;
  deviceId: string;        // Sowel device id
  orderKey: string;
  status: "pending" | "received" | "delivered" | "refused" | "not_received" | "unconfirmed";
  late?: boolean;          // a receipt that arrived after an unconfirmed/not_received
}
```

| Status         | Meaning                                 | Terminal        |
| -------------- | --------------------------------------- | --------------- |
| `pending`      | sent, the device is expected to answer  | no              |
| `received`     | the radio link acknowledged it          | no              |
| `delivered`    | the device applied it, or already had   | yes             |
| `refused`      | the device understood it and refused it | yes             |
| `not_received` | the radio link gave up                  | yes, upgradable |
| `unconfirmed`  | no answer in time                       | yes, upgradable |

`pending` is what tells the core this device answers at all. A device whose integration
never emits it behaves exactly as today.

### R2 — Correlation

The core remembers, per `(deviceId, orderKey)`, the last order it dispatched: equipment,
alias, value, source, time, and — for a shared-access press — the journal row. A receipt
updates that order. A receipt for a device/key with no order dispatched in the last 2 minutes
is ignored (debug log). A second order on the same device/key replaces the first; the first's
late receipts are then dropped. The shared-access gate queue already serialises presses per
gate, so the guest case never overlaps.

The core re-emits it as `equipment.order.receipt { equipmentId, orderAlias, status, late?,
source }` and broadcasts it on the WebSocket.

### R3 — Alarm

`refused`, `not_received` and `unconfirmed` raise `order-receipt:<equipmentId>:<alias>`
(level `warning`), e.g. « Portail : commande « ouvrir » sans confirmation du portail ». The
existing pipeline pushes it. A later `delivered` on the same equipment/alias resolves it —
including a late receipt for the same order. A new order that gets `pending` does not
resolve it (same rule as spec 141's supersession).

### R4 — Tile and detail

The equipment's last order shows a status line on its dashboard tile (desktop and mobile)
and on its detail page, for equipments whose device answered `pending`:

| Status       | Line                       | Lasts                 |
| ------------ | -------------------------- | --------------------- |
| pending      | spinner « Envoyée… »       | until the next status |
| received     | spinner « Reçue… »         | until the next status |
| delivered    | « ✓ Confirmée »            | 4 s, then nothing     |
| refused      | « Refusée par l'appareil » | until the next order  |
| not_received | « Non reçue »              | until the next order  |
| unconfirmed  | « Sans confirmation »      | until the next order  |

The line is live state, held in the UI store from the WebSocket event; a page reload shows
nothing until the next order.

### R5 — Shared access

- **The guest page shows the outcome of its own press, and nothing else.** A press only ever
  targets a gate of the access, and the page learns the outcome through that press's
  journal row — never through the WebSocket or another equipment's receipt. A receipt for
  any other equipment (the coop, a light) can neither reach the page nor its journal.
- `open()` records the press as today (`opened`), and gains a receipt for it: the journal
  row gets a `receipt` column (`pending` / `delivered` / `refused` / `not_received` /
  `unconfirmed`), NULL for gates whose device does not answer.
- `POST open` returns `{ ok: true, receipt: "pending" }` when one is expected.
- The guest page then reads the session every second for up to 20 s, while the press's
  receipt is pending:
  - `delivered` → orb « REÇU », pill « Ouverture confirmée », journal « Ouverture confirmée »;
  - `refused` → pill « Commande refusée », message « Le portail a refusé la commande. »;
  - `not_received` → « Le portail n'a pas reçu la commande. Vous pouvez réessayer. »;
  - `unconfirmed` → « Pas de confirmation : regardez le portail avant de réessayer, il a
    peut-être bougé. »
    The travel bar keeps running from the press, as today.
- The admin journal shows the same receipt next to each `opened` row.
- Counters and ceilings (`countUse`) are unchanged: a press counts when it is sent.

### R6 — Plugin lora2mqtt (`mchacher/sowel-plugin-lora2mqtt`)

- A node with `"receipts": true` in `bridge/devices` gets receipts; others behave as today.
- `executeOrder` adds `"#id": <uuid>` to the payload, emits `pending`, and returns at once —
  it does not wait, so the core's dispatch retry (2 s) never fires on a slow receipt.
- `lora2mqtt/<node>/receipt` maps to `received` / `delivered` / `refused` / `not_received`
  / `unconfirmed` (`timeout`), matched by id; unknown ids are ignored.
- If the bridge says nothing for 20 s (bridge restarted), the plugin emits `unconfirmed`.

## Edge cases

- Device never answers `pending` (other integrations, old LoRa nodes): no line, no alarm,
  no receipt column — today's behaviour.
- A receipt arrives late after `unconfirmed` → `delivered` with `late: true`: line becomes
  « ✓ Confirmée », alarm resolved, guest journal row upgraded.
- Two orders on one gate within a second (two admins): the second replaces the first in the
  correlation; the first's outcome is not shown.
- Core restart with orders pending: lost, nothing shown.
- The gate refused a bad signature: the node stays silent by design, so this reads
  « Sans confirmation », never « Refusée ».

## Acceptance criteria

- [x] `device.order.receipt` exists, is in `ALLOWED_EMIT_TYPES`, and is validated (known
      status, the plugin's own integration id).
- [x] Correlation per (device, key), 2 min window, last order wins.
- [x] `equipment.order.receipt` emitted and broadcast on WS.
- [x] Alarm raised on refused / not_received / unconfirmed, resolved by delivered, not by
      supersession.
- [x] Tile + detail status line per R4, EN + FR.
- [x] Shared-access journal `receipt` column (migration 037), `open` returns `receipt`,
      session presses carry it.
- [x] Guest page follows the receipt per R5, EN + FR, and the served page is the core's
      `src/shared-access/guest-page.ts` (the one at `acces.domainesolio.com`), not the
      retired guest-access plugin.
- [ ] Plugin lora2mqtt per R6 — companion PR in `mchacher/sowel-plugin-lora2mqtt`.
- [x] Tests per plan.md.
